# JoyoFit cloud (Cloudflare Worker)

A small backend for the JoyoFit app: it accepts JoyoRogo sign-ins and stores what the app uploads in
D1, with a raw-file endpoint into R2 for the future Huawei-export importer.

- Hono + TypeScript on Workers, D1 (`DB`), R2 (`IMPORTS`).
- Auth: the app sends its JoyoRogo better-auth session cookies; the Worker asks
  `${JOYOROGO_AUTH_URL}/api/auth/get-session` who they belong to. See
  [`JOYOROGO_PATCH.md`](JOYOROGO_PATCH.md) for the one change JoyoRogo needs and why.
- Every row is keyed by the JoyoRogo user id; one user can never read or overwrite another's.

## API

All endpoints need `Cookie: <JoyoRogo session cookies>`; without a live session they answer `401`
(`503` when JoyoRogo itself cannot be reached).

| Endpoint | What it does |
|---|---|
| `GET /v1/me` | `{ user: {id, email, name}, rev, lastSyncAt }` |
| `POST /v1/sync` | Batched upsert. JSON body, at most 3 MB: `stepSamples` (≤ 5 000), `sleepSegments` (≤ 2 000), `workouts` (≤ 50, each with `points`, ≤ 30 000), `devices` (≤ 10). Validated with zod (`400` with the issues, `413` too big). Idempotent: a row identical to the stored one is not rewritten. Answers `{ rev, written }`. |
| `GET /v1/sync?since=<rev>&limit=<n>` | Pull for other devices: rows changed after `since`, oldest change first, across all tables (`limit` ≤ 1 000, workouts ≤ 25 per page). Answers the four arrays plus `cursor` (the next `since`) and `hasMore`. |
| `POST /v1/imports?filename=<name>` | The request body is the file, streamed straight into R2 at `imports/<userId>/<uuid>` (needs `Content-Length`, at most `MAX_IMPORT_BYTES`, default 100 MiB). Records an `imports` row (`uploading` → `uploaded`, or `failed`). Answers `201 {id, status, size, ...}`. |
| `GET /v1/imports` | The caller's 50 newest imports. |

`rev` is a per-user change counter: each row a request creates or changes gets its own increasing value,
which is what `since` filters on. D1 schema: [`migrations/0001_init.sql`](migrations/0001_init.sql)
(`step_samples`, `sleep_segments` with `stage`, `workouts`, `workout_points`, `device`, `user_state`,
`imports`).

Each table is written as one JSON bind parameter expanded with `json_each`, so a request costs a handful of
D1 statements however large it is (D1 allows 100 bound parameters and, on the free plan, 50 queries per
invocation).

## Setup (you run these)

You need a Cloudflare account and `wrangler` login (`bunx wrangler login`). From this directory:

```bash
bun install

# 1. D1 + R2
bunx wrangler d1 create joyofit          # prints database_id
bunx wrangler r2 bucket create joyofit-imports
```

Edit `wrangler.jsonc`: put the printed `database_id` in `d1_databases[0].database_id` (the
`0000…` value is a placeholder), and the bucket name if you chose another. Then:

```bash
# 2. Schema
bun run db:migrate:remote                # wrangler d1 migrations apply joyofit --remote

# 3. JoyoRogo origin (default https://api.joyorogo.com) — change in wrangler.jsonc `vars` if needed:
#    "JOYOROGO_AUTH_URL": "https://api.joyorogo.com"

# 4. Deploy
bun run deploy                           # wrangler deploy; prints https://joyofit-api.<subdomain>.workers.dev
```

Then apply [`JOYOROGO_PATCH.md`](JOYOROGO_PATCH.md) to JoyoRogo and redeploy it, and build the app with the
printed URL: `EXPO_PUBLIC_JOYOFIT_CLOUD_URL=https://joyofit-api.<subdomain>.workers.dev` (or set
`expo.extra.cloudUrl` in the app's `app.json`).

Local development: `bun run db:migrate:local && bun run dev`.

## Develop

```bash
bun run test         # vitest + @cloudflare/vitest-plugin (miniflare): auth, idempotency, user isolation, imports
bunx tsc --noEmit
bun run types        # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

The tests replace JoyoRogo with a fake `get-session` (a stubbed `fetch`, and a fake `AUTH_SERVICE` binding
for the service-binding path).

## Notes

- Sessions are cached per isolate for 60 s; a session revoked in JoyoRogo keeps working here for up to
  that long. Failures are never cached.
- Deletions are not synced: the app never deletes rows, and the server has no delete endpoint yet.
- The importer for the Huawei export does not exist yet; `imports.r2_key` and `status` are where it will
  pick files up (`uploaded` → its own states).
