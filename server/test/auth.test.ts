import { describe, expect, it } from "vitest";

import { call, fakeGetSession, postJson, signUp, upstream } from "./helpers";

describe("auth", () => {
  it("rejects every endpoint without a session cookie", async () => {
    const responses = await Promise.all([
      call("/v1/me"),
      call("/v1/sync"),
      postJson("/v1/sync", { stepSamples: [] }),
      call("/v1/imports"),
      call("/v1/imports", { method: "POST", body: "x", headers: { "content-length": "1" } }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(upstream.calls).toHaveLength(0);
  });

  it("rejects cookies that are not better-auth session cookies without asking JoyoRogo", async () => {
    const response = await call("/v1/me", { cookie: "theme=dark; _ga=GA1.2" });
    expect(response.status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });

  it("rejects a session JoyoRogo does not know", async () => {
    const response = await call("/v1/me", { cookie: "__Secure-better-auth.session_token=token-nobody.sig" });
    expect(response.status).toBe(401);
    expect(upstream.calls).toHaveLength(1);
  });

  it("rejects an unknown session on writes and writes nothing", async () => {
    const response = await postJson(
      "/v1/sync",
      { stepSamples: [{ timestamp: 1, steps: 1, calories: 0, distance: 0 }] },
      "__Secure-better-auth.session_token=token-nobody.sig",
    );
    expect(response.status).toBe(401);
  });

  it("returns the verified user from /v1/me and forwards only session cookies to JoyoRogo", async () => {
    const { user, cookie } = signUp("alice");
    const response = await call("/v1/me", { cookie: `analytics=1; ${cookie}; better-auth.session_data=abc` });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { user: { id: string; email: string }; rev: number };
    expect(json.user.id).toBe(user.id);
    expect(json.user.email).toBe(user.email);
    expect(json.rev).toBe(0);
    expect(upstream.calls).toEqual([
      { url: "https://api.joyorogo.com/api/auth/get-session", cookie: `${cookie}; better-auth.session_data=abc` },
    ]);
  });

  it("reuses a verified session for a short while", async () => {
    const { cookie } = signUp("bob");
    expect((await call("/v1/me", { cookie })).status).toBe(200);
    expect((await call("/v1/me", { cookie })).status).toBe(200);
    expect(upstream.calls).toHaveLength(1);
  });

  it("answers 503, not 401, when JoyoRogo is down", async () => {
    const { cookie } = signUp("carol");
    upstream.failWith = 500;
    const response = await call("/v1/me", { cookie });
    expect(response.status).toBe(503);
    // A failure is not cached: the next request asks again and succeeds.
    upstream.failWith = null;
    expect((await call("/v1/me", { cookie })).status).toBe(200);
  });

  it("calls JoyoRogo through the AUTH_SERVICE binding when it is configured", async () => {
    const { user, cookie } = signUp("dave");
    const seen: string[] = [];
    const AUTH_SERVICE = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(String(input));
        return fakeGetSession(new Headers(init?.headers).get("cookie"));
      },
    } as Fetcher;
    const response = await call("/v1/me", { cookie, env: { AUTH_SERVICE } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { user: { id: string } }).user.id).toBe(user.id);
    expect(seen).toEqual(["https://api.joyorogo.com/api/auth/get-session"]);
    expect(upstream.calls).toHaveLength(0);
  });
});
