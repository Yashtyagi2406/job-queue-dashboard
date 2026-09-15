# Mini Job Queue Dashboard

A small full-stack job queue management dashboard.

- **Backend:** NestJS + TypeORM + SQLite
- **Frontend:** React (Vite)

## Project structure

```
airth-job-queue/
  backend/    NestJS API
  frontend/   React dashboard
```

## Setup

### Backend

```bash
cd backend
npm install
npm run build
npm run start        # or: npm run start:dev for hot reload
```

The API listens on `http://localhost:3000` by default. Configure with env vars:

- `PORT` — port to listen on (default `3000`)
- `DB_PATH` — SQLite file path (default `job-queue.sqlite`, created automatically)
- `CORS_ORIGIN` — allowed frontend origin (default `*`)

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # set VITE_API_URL if the backend isn't on localhost:3000
npm run dev
```

Opens on `http://localhost:5173`.

## API

| Method | Route               | Body                          | Notes |
|--------|---------------------|--------------------------------|-------|
| POST   | `/jobs`              | `{ title, type }`             | Creates a job with status `pending` |
| GET    | `/jobs`              | –                              | Returns all jobs, newest first |
| PATCH  | `/jobs/:id/status`   | `{ status }`                  | Attempts a status transition |
| DELETE | `/jobs/:id`          | –                              | Deletes a job |

`type` must be one of `email`, `report`, `data-sync`, `image-processing`, `other`.
`status` must be one of `pending`, `running`, `completed`, `failed`.

Errors:
- `400` — validation failure (missing/invalid fields, or an unknown field in the body)
- `404` — job not found
- `422` — the requested status transition is not legal from the job's current status
- `409` — the transition was legal when requested, but another request changed the
  job's status first (see the concurrency section below)

## Data model

Each job has: `id` (UUID), `title`, `type`, `status`, `createdAt`, and an internal
`version` counter (kept for observability/debugging, not used to enforce the race
condition fix below).

## Design decisions and trade-offs

- **SQLite over Postgres.** The assignment says either is fine; SQLite means the
  project runs with zero external setup, which matters more here than the extra
  concurrency guarantees Postgres would offer. The transition-enforcing query
  (below) is written in plain TypeORM query-builder SQL, so switching the
  `type: 'sqlite'` in `app.module.ts` to Postgres config is close to a one-line
  change if that's preferred.
- **`synchronize: true`** on the TypeORM connection auto-creates the schema from
  the entity. Fine for an assignment of this size; a real project would use
  migrations instead so schema changes are reviewable and reversible.
- **Whitelist validation** (`forbidNonWhitelisted: true`) rejects requests with
  unexpected fields rather than silently dropping them — it's a stricter,
  more honest failure mode for an API that other systems (or a bypassing
  script) might call directly.
- **UI mirrors the backend's transition table** only to decide which action
  buttons to show (e.g. a `completed` job shows no status buttons). This is a
  UX nicety, not the enforcement mechanism — the backend independently
  re-validates every request, so the UI's copy of the rules being out of date
  or bypassed entirely changes nothing about correctness.

## Part 3 — Reasoning about concurrency and invalid states

**Where should the transition rule be enforced?**
Only in the backend. The React app hiding illegal buttons is a UX convenience,
not a safety measure — anyone with `curl` or Postman can call the API directly
and skip the UI entirely. The API is the only party that can be trusted to
enforce the rule, so `JobsService.updateStatus` is the single place the
`pending → running → completed|failed` state machine is defined
(`ALLOWED_TRANSITIONS` in `jobs.service.ts`), and every request — from the
dashboard or otherwise — goes through it.

**What happens if someone bypasses the UI and calls the API directly?**
Nothing bad: the same validation and transition checks run regardless of the
caller. A `PATCH /jobs/:id/status` with an illegal transition (e.g.
`completed → running`) gets a `422` with a message naming the job's current
status and what it could legally move to next. An unknown status value gets a
`400` from `class-validator`. There's no "trusted" caller — the API is the
trust boundary, not the browser.

**What happens when two requests arrive at nearly the same time?**
This is the interesting one. A naive implementation reads the job, checks in
application code that the transition is legal, then writes the new status —
but that read-check-write sequence isn't atomic. If two requests for the same
job both read `status: pending` before either has written `running`, both
would pass the in-memory check and both would issue a write; whichever writes
last "wins" silently, and depending on the ORM you can end up with a duplicated
side effect (e.g. a job picked up by two workers) even though only one
`UPDATE` should have been allowed to succeed.

The fix used here is an **atomic conditional update** — a single SQL statement
that only affects a row if it still matches the expected starting status:

```sql
UPDATE jobs SET status = 'running' WHERE id = :id AND status = 'pending'
```

Both concurrent requests can prepare this statement, but the database
guarantees only one of them can actually match a row: whichever commits first
changes `status` out from under the other, so the second request's `WHERE`
clause matches zero rows. No explicit lock, mutex, or message broker is
needed — the database's own row-level write serialization does the job. The
service checks `result.affected`: `0` means someone else got there first, so
it re-reads the job and returns a `409 Conflict` with the job's actual current
status, rather than silently succeeding or silently failing.

This was verified directly: firing two simultaneous
`PATCH /jobs/:id/status {status: running}` requests at the same `pending` job
resulted in exactly one `200 OK` (job now `running`) and one `422` (because by
the time the second statement ran, the job was no longer `pending`) — the job
never ends up in a corrupted or double-processed state.

**How would you prevent an invalid or inconsistent state in general?**
Two layers, both enforced server-side: (1) a single explicit transition table
that is consulted before any write, so "what's legal from here" is defined in
exactly one place, and (2) making the write itself conditional on the
precondition it depends on, so the check and the write can't be pulled apart
by a race. This generalizes past just this state machine — anywhere a
"read current state, decide, write new state" flow exists, the fix is to fold
the "decide" step's condition into the `WHERE` clause of the write rather than
trusting an earlier, now-possibly-stale, read.

## Bonus: production-readiness improvement

**Idempotency-safe atomic status transitions (implemented above), plus a
`409 Conflict` response contract for clients.** I chose this over other
options (e.g. a message queue, retries, auth) because the assignment's own
"think about this" section calls out the exact failure mode it fixes, and
because it's the kind of bug that's invisible in a demo but real in
production — a job queue that can be flipped into two conflicting states by
two workers racing is worse than useless, since downstream consumers may
believe a job is running when it's actually already failed.

With more time, I'd add:
- **Structured logging + correlation IDs** on every request, so a `409` in
  production can be traced back to which two callers actually raced.
- **A `PATCH` retry contract on the frontend**: on `409`, the UI already
  refetches and shows the real current state; a nicer version would also
  offer a one-click "retry with the new state" if the user's intended next
  transition is still legal from wherever the job landed.
- **Pagination and server-side filtering** on `GET /jobs` once the job list
  is large enough that fetching everything client-side stops being practical.
- **Postgres in place of SQLite** for real concurrent-write throughput, using
  the same conditional-`UPDATE` pattern (it's standard SQL, not SQLite-specific).

## Assumptions

- No authentication/authorization was requested, so none is implemented —
  the assignment describes two *browser tabs*, not two *users*, and is
  scoped as a small dashboard, not a multi-tenant system.
- "Two browser tabs" was read as the general case of "any two concurrent
  callers," including direct API calls, not literally limited to the UI.
- Job `type` was constrained to a small fixed set of plausible values
  (`email`, `report`, `data-sync`, `image-processing`, `other`) since the
  assignment doesn't specify allowed types; this can trivially be changed to
  a free-text field if arbitrary types are wanted instead.
