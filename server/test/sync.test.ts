import { describe, expect, it } from "vitest";

import { call, env, postJson, signUp } from "./helpers";

const step = (timestamp: number, steps = 10) => ({ timestamp, steps, calories: 1, distance: 5, heartRate: 70, spo2: null, restingHeartRate: null });
const sleep = (start: number) => ({ start, end: start + 600, type: 1, stage: "deep" });

interface SyncResponse {
  rev: number;
  written: { stepSamples: number; sleepSegments: number; workouts: number; devices: number };
}
interface PullResponse {
  stepSamples: { timestamp: number; steps: number; rev: number }[];
  sleepSegments: { start: number; stage: string | null }[];
  workouts: { start: number; complete: boolean; points: { ts: number; lat: number | null; hr: number | null }[] }[];
  devices: { address: string; lastSync: number | null }[];
  cursor: number;
  hasMore: boolean;
}

async function count(table: string, userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`).bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("POST /v1/sync", () => {
  it("stores every table and reports what it wrote", async () => {
    const { user, cookie } = signUp("alice");
    const response = await postJson(
      "/v1/sync",
      {
        stepSamples: [step(1000), step(1060)],
        sleepSegments: [sleep(2000)],
        devices: [{ address: "AA:BB", name: "HUAWEI WATCH FIT 4", productModel: "Fit 4 Pro", softwareVersion: "1.0", lastSync: 1100 }],
        workouts: [
          {
            workoutNumber: 3,
            start: 3000,
            end: 3600,
            sportType: 2,
            sportName: "Running",
            duration: 600,
            distance: 1500,
            calories: 80,
            avgHr: 120,
            maxHr: 150,
            steps: 1800,
            summaryJson: "{}",
            complete: true,
            points: [
              { ts: 3000, lat: -6.9, lon: 107.6, alt: 700.5, hr: null },
              { ts: 3001, hr: 100 },
            ],
          },
        ],
      },
      cookie,
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as SyncResponse;
    expect(json.written).toEqual({ stepSamples: 2, sleepSegments: 1, workouts: 1, devices: 1 });
    expect(json.rev).toBe(5);
    expect(await count("step_samples", user.id)).toBe(2);
    expect(await count("sleep_segments", user.id)).toBe(1);
    expect(await count("workouts", user.id)).toBe(1);
    expect(await count("workout_points", user.id)).toBe(2);
    expect(await count("device", user.id)).toBe(1);
  });

  it("is idempotent: replaying a batch changes nothing and never reappears in a pull", async () => {
    const { user, cookie } = signUp("alice");
    const body = { stepSamples: [step(1000), step(1060)], sleepSegments: [sleep(2000)] };
    const first = (await (await postJson("/v1/sync", body, cookie)).json()) as SyncResponse;
    const second = (await (await postJson("/v1/sync", body, cookie)).json()) as SyncResponse;
    expect(second.written).toEqual({ stepSamples: 0, sleepSegments: 0, workouts: 0, devices: 0 });
    expect(await count("step_samples", user.id)).toBe(2);
    expect(await count("sleep_segments", user.id)).toBe(1);

    const pull = (await (await call(`/v1/sync?since=${first.rev}`, { cookie })).json()) as PullResponse;
    expect(pull.stepSamples).toEqual([]);
    expect(pull.hasMore).toBe(false);
    expect(pull.cursor).toBe(first.rev);
  });

  it("collapses duplicate rows inside one batch", async () => {
    const { user, cookie } = signUp("alice");
    const response = await postJson("/v1/sync", { stepSamples: [step(1000, 1), step(1000, 9)] }, cookie);
    expect(response.status).toBe(200);
    expect(await count("step_samples", user.id)).toBe(1);
    const pull = (await (await call("/v1/sync", { cookie })).json()) as PullResponse;
    expect(pull.stepSamples.map((s) => s.steps)).toEqual([9]);
  });

  it("updates a changed row and pulls only the change", async () => {
    const { cookie } = signUp("alice");
    const first = (await (await postJson("/v1/sync", { stepSamples: [step(1000, 1), step(1060, 2)] }, cookie)).json()) as SyncResponse;
    const second = (await (await postJson("/v1/sync", { stepSamples: [step(1000, 1), step(1060, 99)] }, cookie)).json()) as SyncResponse;
    expect(second.written.stepSamples).toBe(1);
    expect(second.rev).toBeGreaterThan(first.rev);
    const pull = (await (await call(`/v1/sync?since=${first.rev}`, { cookie })).json()) as PullResponse;
    expect(pull.stepSamples.map((s) => [s.timestamp, s.steps])).toEqual([[1060, 99]]);
  });

  it("replaces a workout and its points as a whole", async () => {
    const { user, cookie } = signUp("alice");
    const workout = {
      workoutNumber: 1,
      start: 5000,
      end: 5600,
      sportType: 1,
      sportName: "Walking",
      duration: 500,
      distance: 700,
      calories: 30,
      steps: 900,
      summaryJson: "{}",
      complete: false,
    };
    await postJson("/v1/sync", { workouts: [{ ...workout, points: [{ ts: 1, hr: 90 }, { ts: 2, hr: 91 }, { ts: 3, hr: 92 }] }] }, cookie);
    expect(await count("workout_points", user.id)).toBe(3);
    await postJson("/v1/sync", { workouts: [{ ...workout, complete: true, points: [{ ts: 1, hr: 90 }, { ts: 2, hr: 91 }] }] }, cookie);
    expect(await count("workouts", user.id)).toBe(1);
    expect(await count("workout_points", user.id)).toBe(2);
    const pull = (await (await call("/v1/sync", { cookie })).json()) as PullResponse;
    expect(pull.workouts).toHaveLength(1);
    expect(pull.workouts[0]?.complete).toBe(true);
    expect(pull.workouts[0]?.points.map((p) => p.hr)).toEqual([90, 91]);
  });

  it("rejects invalid bodies with 400 and writes nothing", async () => {
    const { user, cookie } = signUp("alice");
    const bad = [
      { stepSamples: [{ timestamp: "x", steps: 1, calories: 0, distance: 0 }] },
      { stepSamples: [{ timestamp: 1, steps: -1, calories: 0, distance: 0 }] },
      { stepSamples: [{ timestamp: 1, steps: 1, calories: 0, distance: 0, heartRate: 999 }] },
      { stepSamples: Array.from({ length: 5001 }, (_, i) => step(i)) },
      { sleepSegments: [{ start: 1, end: 2, type: 1, stage: "x".repeat(100) }] },
    ];
    for (const body of bad) {
      const response = await postJson("/v1/sync", body, cookie);
      expect(response.status).toBe(400);
    }
    const notJson = await call("/v1/sync", { method: "POST", body: "{nope", cookie });
    expect(notJson.status).toBe(400);
    expect(await count("step_samples", user.id)).toBe(0);
  });

  it("refuses oversized bodies with 413", async () => {
    const { cookie } = signUp("alice");
    const declared = await call("/v1/sync", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "3000001" },
      cookie,
    });
    expect(declared.status).toBe(413);
    const real = await call("/v1/sync", { method: "POST", body: " ".repeat(3_000_001), cookie });
    expect(real.status).toBe(413);
  });
});

describe("GET /v1/sync", () => {
  it("pages through every table in change order", async () => {
    const { cookie } = signUp("alice");
    await postJson("/v1/sync", { stepSamples: [step(1), step(2), step(3)], sleepSegments: [sleep(10), sleep(20)] }, cookie);
    const seen: string[] = [];
    let since = 0;
    for (let page = 0; page < 10; page++) {
      const pull = (await (await call(`/v1/sync?since=${since}&limit=2`, { cookie })).json()) as PullResponse;
      for (const s of pull.stepSamples) seen.push(`step:${s.timestamp}`);
      for (const s of pull.sleepSegments) seen.push(`sleep:${s.start}`);
      since = pull.cursor;
      if (!pull.hasMore) break;
    }
    expect(seen.sort()).toEqual(["sleep:10", "sleep:20", "step:1", "step:2", "step:3"]);
  });

  it("validates since and limit", async () => {
    const { cookie } = signUp("alice");
    expect((await call("/v1/sync?since=-1", { cookie })).status).toBe(400);
    expect((await call("/v1/sync?since=abc", { cookie })).status).toBe(400);
    expect((await call("/v1/sync?limit=0", { cookie })).status).toBe(400);
    expect((await call("/v1/sync?limit=1001", { cookie })).status).toBe(400);
  });
});

describe("user isolation", () => {
  it("keeps two users' rows with the same keys apart, in storage and in pulls", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    await postJson("/v1/sync", { stepSamples: [step(1000, 111)], devices: [{ address: "W1", name: "alice watch" }] }, alice.cookie);
    await postJson("/v1/sync", { stepSamples: [step(1000, 222), step(1060, 333)], devices: [{ address: "W1", name: "bob watch" }] }, bob.cookie);

    expect(await count("step_samples", alice.user.id)).toBe(1);
    expect(await count("step_samples", bob.user.id)).toBe(2);

    const alicePull = (await (await call("/v1/sync", { cookie: alice.cookie })).json()) as PullResponse;
    expect(alicePull.stepSamples.map((s) => s.steps)).toEqual([111]);
    expect(alicePull.devices).toHaveLength(1);
    const bobPull = (await (await call("/v1/sync", { cookie: bob.cookie })).json()) as PullResponse;
    expect(bobPull.stepSamples.map((s) => s.steps).sort()).toEqual([222, 333]);

    // Each user has an own change counter.
    const aliceMe = (await (await call("/v1/me", { cookie: alice.cookie })).json()) as { rev: number };
    const bobMe = (await (await call("/v1/me", { cookie: bob.cookie })).json()) as { rev: number };
    expect(aliceMe.rev).toBe(2);
    expect(bobMe.rev).toBe(3);
  });

  it("does not let one user overwrite another's workout or points", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    const workout = (steps: number) => ({
      workoutNumber: 1,
      start: 7000,
      end: 7600,
      sportType: 1,
      sportName: "Walking",
      duration: 500,
      distance: 700,
      calories: 30,
      steps,
      summaryJson: "{}",
      complete: true,
      points: [{ ts: 1, hr: steps }],
    });
    await postJson("/v1/sync", { workouts: [workout(111)] }, alice.cookie);
    await postJson("/v1/sync", { workouts: [workout(222)] }, bob.cookie);
    const alicePull = (await (await call("/v1/sync", { cookie: alice.cookie })).json()) as PullResponse;
    expect(alicePull.workouts[0]?.points.map((p) => p.hr)).toEqual([111]);
    const bobPull = (await (await call("/v1/sync", { cookie: bob.cookie })).json()) as PullResponse;
    expect(bobPull.workouts[0]?.points.map((p) => p.hr)).toEqual([222]);
  });
});
