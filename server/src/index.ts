import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { requireUser } from "./auth";
import type { AppContext } from "./env";
import { imports } from "./imports";
import { MAX_SYNC_BODY_BYTES, PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT } from "./limits";
import { syncBodySchema } from "./schemas";
import { applySync, pullSync } from "./sync";

const app = new Hono<AppContext>();

app.get("/", (c) => c.json({ service: "joyofit-api", ok: true }));

const v1 = new Hono<AppContext>();
v1.use("*", requireUser);

/** Reads and parses a JSON body, refusing more than `max` bytes even when `Content-Length` is missing or wrong. */
async function readJson(request: Request, max: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new HTTPException(413, { message: "too_large" });
  const reader = request.body?.getReader();
  if (!reader) throw new HTTPException(400, { message: "empty_body" });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HTTPException(413, { message: "too_large" });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HTTPException(400, { message: "invalid_json" });
  }
}

v1.get("/me", async (c) => {
  const user = c.get("user");
  const state = await c.env.DB.prepare("SELECT rev, last_sync_at FROM user_state WHERE user_id = ?1")
    .bind(user.id)
    .first<{ rev: number; last_sync_at: number | null }>();
  return c.json({ user, rev: state?.rev ?? 0, lastSyncAt: state?.last_sync_at ?? null });
});

v1.post("/sync", async (c) => {
  const body = syncBodySchema.parse(await readJson(c.req.raw, MAX_SYNC_BODY_BYTES));
  const result = await applySync(c.env.DB, c.get("user").id, body, Date.now());
  return c.json(result);
});

v1.get("/sync", async (c) => {
  const since = Number(c.req.query("since") ?? "0");
  const limit = Number(c.req.query("limit") ?? PULL_DEFAULT_LIMIT);
  if (!Number.isInteger(since) || since < 0) return c.json({ error: "invalid_since" }, 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > PULL_MAX_LIMIT) {
    return c.json({ error: "invalid_limit", max: PULL_MAX_LIMIT }, 400);
  }
  return c.json(await pullSync(c.env.DB, c.get("user").id, since, limit));
});

v1.route("/imports", imports);
app.route("/v1", v1);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json({ error: "invalid_body", issues: error.issues.slice(0, 20) }, 400);
  }
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error(JSON.stringify({ event: "unhandled", path: c.req.path, message: error.message }));
  return c.json({ error: "internal_error" }, 500);
});

export default app;
