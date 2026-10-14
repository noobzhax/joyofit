import { createMiddleware } from "hono/factory";
import { z } from "zod";

import type { AppContext, AppEnv, AuthUser } from "./env";
import { AUTH_CACHE_MAX_ENTRIES, AUTH_CACHE_TTL_MS, AUTH_TIMEOUT_MS } from "./limits";

/** JoyoRogo could not be asked (network error, timeout, 5xx). The caller's credentials are not at fault. */
export class AuthUnavailableError extends Error {}

const sessionSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string(),
    name: z.string().nullish(),
  }),
  session: z.looseObject({ expiresAt: z.union([z.string(), z.number()]).optional() }).optional(),
});

/**
 * Keeps only better-auth session cookies (`[__Secure-]<prefix>.session_token` / `.session_data`) from a `Cookie`
 * header, so nothing else the client sends is forwarded to JoyoRogo. Returns null when no session token is there.
 */
export function sessionCookies(header: string | null): string | null {
  if (!header) return null;
  const kept: string[] = [];
  let hasToken = false;
  for (const part of header.split(";")) {
    const pair = part.trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    if (!/session_(token|data)$/.test(name)) continue;
    if (name.endsWith("session_token")) hasToken = true;
    kept.push(pair);
  }
  return hasToken ? kept.join("; ") : null;
}

interface CacheEntry {
  user: AuthUser;
  expiresAt: number;
}

/**
 * Per-isolate cache of verified sessions, keyed by a hash of the session cookies. It bounds how often a sync
 * burst calls JoyoRogo; it is not a source of truth, and failures are never cached. A revoked session keeps
 * working here for at most AUTH_CACHE_TTL_MS (JoyoRogo's own cookie cache has a 5 minute window).
 */
const verified = new Map<string, CacheEntry>();

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function remember(key: string, user: AuthUser, now: number, sessionExpiresAt: number | null): void {
  if (verified.size >= AUTH_CACHE_MAX_ENTRIES) {
    for (const [k, v] of verified) if (v.expiresAt <= now) verified.delete(k);
    if (verified.size >= AUTH_CACHE_MAX_ENTRIES) {
      const oldest = verified.keys().next();
      if (!oldest.done) verified.delete(oldest.value);
    }
  }
  const ttlEnd = now + AUTH_CACHE_TTL_MS;
  verified.set(key, { user, expiresAt: sessionExpiresAt ? Math.min(ttlEnd, sessionExpiresAt) : ttlEnd });
}

/** Test hook: forget every verified session. */
export function clearAuthCache(): void {
  verified.clear();
}

/**
 * Asks JoyoRogo's better-auth who owns these cookies: `GET <JOYOROGO_AUTH_URL>/api/auth/get-session`, through the
 * `AUTH_SERVICE` service binding when present. Returns null when JoyoRogo says there is no session.
 */
async function fetchSession(env: AppEnv, cookie: string): Promise<{ user: AuthUser; expiresAt: number | null } | null> {
  const url = `${env.JOYOROGO_AUTH_URL.replace(/\/+$/, "")}/api/auth/get-session`;
  const init: RequestInit = {
    method: "GET",
    headers: { cookie, accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  };
  let response: Response;
  try {
    response = await (env.AUTH_SERVICE ? env.AUTH_SERVICE.fetch(url, init) : fetch(url, init));
  } catch (error) {
    throw new AuthUnavailableError(`JoyoRogo auth unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AuthUnavailableError(`JoyoRogo auth answered ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AuthUnavailableError("JoyoRogo auth answered with invalid JSON");
  }
  // better-auth answers 200 with a JSON `null` body when the cookies hold no live session.
  if (json === null) return null;
  const parsed = sessionSchema.safeParse(json);
  if (!parsed.success) throw new AuthUnavailableError("JoyoRogo auth answered with an unexpected shape");
  const { user, session } = parsed.data;
  const expiry = session?.expiresAt === undefined ? NaN : new Date(session.expiresAt).getTime();
  return {
    user: { id: user.id, email: user.email, name: user.name ?? null },
    expiresAt: Number.isFinite(expiry) ? expiry : null,
  };
}

export async function verifyUser(env: AppEnv, cookieHeader: string | null): Promise<AuthUser | null> {
  const cookie = sessionCookies(cookieHeader);
  if (!cookie) return null;
  const key = await sha256Hex(cookie);
  const now = Date.now();
  const hit = verified.get(key);
  if (hit && hit.expiresAt > now) return hit.user;
  verified.delete(key);
  const session = await fetchSession(env, cookie);
  if (!session) return null;
  remember(key, session.user, now, session.expiresAt);
  return session.user;
}

/** Rejects with 401 unless the `Cookie` header carries a live JoyoRogo session; sets `c.var.user`. */
export const requireUser = createMiddleware<AppContext>(async (c, next) => {
  let user: AuthUser | null;
  try {
    user = await verifyUser(c.env, c.req.header("cookie") ?? null);
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      console.error(JSON.stringify({ event: "auth_unavailable", message: error.message }));
      return c.json({ error: "auth_unavailable" }, 503);
    }
    throw error;
  }
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
});
