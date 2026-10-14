import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, vi } from "vitest";

import app from "../src";
import { clearAuthCache } from "../src/auth";
import type { AppEnv } from "../src/env";

export interface FakeUser {
  id: string;
  email: string;
  name: string;
}

/** The sessions the fake JoyoRogo knows: token -> user. */
const sessions = new Map<string, FakeUser>();
export const upstream = { calls: [] as { url: string; cookie: string | null }[], failWith: null as number | null };

let counter = 0;
/** Registers a user and returns the Cookie header the app would send for them. */
export function signUp(name: string): { user: FakeUser; cookie: string } {
  counter += 1;
  const user = { id: `user-${name}-${counter}`, email: `${name}-${counter}@example.com`, name };
  const token = `token-${name}-${counter}`;
  sessions.set(token, user);
  return { user, cookie: `__Secure-better-auth.session_token=${token}.sig` };
}

/** What JoyoRogo's `/api/auth/get-session` answers for a Cookie header. */
export function fakeGetSession(cookie: string | null): Response {
  if (upstream.failWith) return new Response("boom", { status: upstream.failWith });
  const match = /session_token=(token-[^.;]+)/.exec(cookie ?? "");
  const user = match?.[1] ? sessions.get(match[1]) : undefined;
  if (!user) return Response.json(null);
  return Response.json({
    user,
    session: { id: "s", userId: user.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
}

beforeEach(() => {
  clearAuthCache();
  upstream.calls = [];
  upstream.failWith = null;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    upstream.calls.push({ url: String(input), cookie: headers.get("cookie") });
    return fakeGetSession(headers.get("cookie"));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

export async function call(
  path: string,
  init: RequestInit & { cookie?: string; env?: Partial<AppEnv> } = {},
): Promise<Response> {
  const { cookie, env: overrides, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set("cookie", cookie);
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`https://api.test${path}`, { ...rest, headers }), { ...env, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export function postJson(path: string, body: unknown, cookie?: string): Promise<Response> {
  return call(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    ...(cookie ? { cookie } : {}),
  });
}

export { env };
