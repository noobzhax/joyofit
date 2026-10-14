import { describe, expect, it } from "vitest";

import { call, env, signUp } from "./helpers";

interface ImportJson {
  id: string;
  status: string;
  size: number;
  filename: string | null;
}

describe("POST /v1/imports", () => {
  it("streams the file into R2 and records a row", async () => {
    const { user, cookie } = signUp("alice");
    const payload = new Uint8Array(5000).map((_, i) => i % 251);
    const response = await call("/v1/imports?filename=huawei-export.zip", {
      method: "POST",
      body: payload,
      headers: { "content-type": "application/zip", "content-length": String(payload.byteLength) },
      cookie,
    });
    expect(response.status).toBe(201);
    const json = (await response.json()) as ImportJson;
    expect(json).toMatchObject({ status: "uploaded", size: 5000, filename: "huawei-export.zip" });

    const row = await env.DB.prepare("SELECT user_id, r2_key, status, size FROM imports WHERE id = ?1")
      .bind(json.id)
      .first<{ user_id: string; r2_key: string; status: string; size: number }>();
    expect(row).toMatchObject({ user_id: user.id, status: "uploaded", size: 5000 });
    expect(row?.r2_key).toBe(`imports/${user.id}/${json.id}`);
    const object = await env.IMPORTS.get(row?.r2_key ?? "");
    expect(object?.httpMetadata?.contentType).toBe("application/zip");
    expect(new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(payload);
  });

  it("requires a Content-Length and enforces the size limit", async () => {
    const { cookie } = signUp("alice");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const noLength = await call("/v1/imports", { method: "POST", body: stream, duplex: "half", cookie } as RequestInit & { cookie: string });
    expect(noLength.status).toBe(411);

    const tooLarge = await call("/v1/imports", {
      method: "POST",
      body: new Uint8Array(20),
      headers: { "content-length": "20" },
      cookie,
      env: { MAX_IMPORT_BYTES: "10" },
    });
    expect(tooLarge.status).toBe(413);

    const empty = await call("/v1/imports", { method: "POST", headers: { "content-length": "0" }, cookie });
    expect(empty.status).toBe(400);
  });

  it("lists only the caller's imports", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    const upload = (cookie: string, name: string) =>
      call(`/v1/imports?filename=${name}`, { method: "POST", body: new Uint8Array(4), headers: { "content-length": "4" }, cookie });
    await upload(alice.cookie, "a.zip");
    await upload(bob.cookie, "b.zip");
    const list = (await (await call("/v1/imports", { cookie: alice.cookie })).json()) as { imports: ImportJson[] };
    expect(list.imports.map((i) => i.filename)).toEqual(["a.zip"]);
  });
});
