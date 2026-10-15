---
name: verify-nouri
description: Verify Nouri's signed-in food journal web page and API through an isolated local PostgreSQL instance and a real browser. Use after changes to account access, data export, food search, food or water logging, food edits, saved meals, daily totals, date navigation, deletion, My Day cards, targets, supplements (the list and daily ticks on My Day), the Overview page (measurements, workouts, sleep, progress photos), workout history on the Progress page, workout routines and live workouts on the Workouts page, or the Review page (its range picker and weight chart), including Google Health sleep, workout, steps, active energy, and heart rate import, the phone layout, and the MCP server's sign-in handshake.
---

# Verify Nouri

Read [features/README.md](features/README.md) and the relevant feature file before driving Nouri. The web page at `/` is the primary user interface. The same server exposes `/v1` endpoints and `/openapi.json`; use the API to confirm stored side effects.

## Launch

Run from the repository root. Docker, `pnpm`, `pg_isready`, `curl`, Python 3, and `playwright cli` must be on `PATH`. The repository `.env` must hold `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` for a Clerk development instance; the helper refuses live keys. Dependencies are described in the root and `frontend/package.json` files; run `pnpm install` if `node_modules` is absent. The helper starts a disposable `postgres:16-alpine` container on a random localhost port, runs `pnpm db:migrate` (`db/schema.sql`, then the numbered files in `db/migrations`), and starts `src/server.ts` on another free localhost port. Each run creates its own Clerk test user (a `+clerk_test` address that never receives mail) and deletes it at cleanup.

The server serves the built page from `web/dist`. `launch` refuses to start when that build is missing or older than `frontend/index.html` or the TypeScript and CSS under `frontend/src` and `src` (the page imports its contracts from `src`). Run `pnpm build:web` first. The helper does not build for you, because rebuilding replaces assets under any other run serving the same `web/dist`. A running server keeps serving the `index.html` it started with, so after rebuilding, clean up and launch a new run.

```sh
RUN_ID="nouri-$(date +%s)-$$"
CONTROL=.agents/skills/verify-nouri/control-nouri
"$CONTROL" launch "$RUN_ID"
source "/tmp/nouri-verify-$RUN_ID/env"
EVIDENCE="/tmp/nouri-verification-evidence/$RUN_ID"
mkdir -p "$EVIDENCE"
```

The helper prints `Healthy Nouri run ...` after checking the page, OpenAPI document, server process, database readiness, and rejection of an anonymous day request. It records its own process and container IDs under `/tmp/nouri-verify-$RUN_ID`. Keep the shell variables for the entire drive. Two runs with different IDs use separate databases, ports, Clerk users, and browser sessions. Never drive an instance started by somebody else.

## Doctor

Run this read-only check first whenever the instance looks wrong. It requires the original app PID and database container ID, checks PostgreSQL readiness, confirms the page and OpenAPI title/version, and checks that the API refuses a request without a session.

```sh
"$CONTROL" doctor "$RUN_ID"
```

## Drive

Use the helper's `browser` action, which runs `playwright cli` in this run's scratch directory with session `nouri-$RUN_ID`. Playwright's automatic snapshots stay there and disappear during cleanup. Use the selectors and accessible names in the feature map. `sign-in-url` prints a single-use link that signs the browser in as the run's user; opening it loads the journal. Opening `$NOURI_BASE_URL/` without it shows Clerk's sign-in instead.

```sh
"$CONTROL" browser "$RUN_ID" open "$("$CONTROL" sign-in-url "$RUN_ID")"
"$CONTROL" browser "$RUN_ID" snapshot
```

The sign-in link, session tokens, and the Clerk secret in `env` are secrets. Do not put `env`, the sign-in URL, browser storage, cookies, or request headers into evidence. Use `"$CONTROL" browser "$RUN_ID" run-code 'async (page) => { ... }'` for assertions with Playwright locators when a snapshot is ambiguous. Do not set app state through `page.evaluate` or call internal functions to create the state under test.

Some recipes seed data or race the page through the public API (Review's week, the edit conflict, the Tokyo entry in Log again). Make those writes from the signed-in page, because Clerk only accepts tokens minted for its origin: in `run-code`, call `page.evaluate` with a `fetch` that sends `Authorization: Bearer ${await window.Clerk.session.getToken()}`, `Content-Type: application/json`, a fresh `Idempotency-Key` from `crypto.randomUUID()`, and `If-Match: "<revision>"` for edits and deletes. That is the same API any client uses, not an internal setter. For long scripts, write the function to a file and pass `"$(cat file.js)"`, which avoids shell-quoting the JavaScript.

## Evidence

Save proof under `$EVIDENCE`; cleanup never removes it. For each feature, record the feature ID and entry point, a screenshot or redacted page snapshot before the user action, the browser action, and the resulting screen. `"$CONTROL" browser "$RUN_ID" screenshot --filename "$EVIDENCE/before.png"` and the same command with `after.png` save screenshots directly. For text proof, write `snapshot` output to `$EVIDENCE`; check it does not contain the address bar's `__clerk_ticket` value.

For a mutation, save an authenticated readback from the endpoint that owns the result: `GET /v1/days/<date>` for food, water, and supplement intakes, `GET /v1/supplement-stack/<date>` for the supplement list, `GET /v1/overview/<date>` for Overview records, or `GET /v1/dashboard` for card layout. Assert the relevant entries and totals. This is a second read of persisted state, not a substitute for the browser action. Search proof should show query, results or empty state, and source attribution. Follow real page controls. Do not use internal setters or test-only endpoints. Mock only a production boundary that already exists; the default Nouri run uses the real local database. Nouri has no dry-run mode. If a future recipe uses one, inspect actual files, network activity, and database state to establish what it skips.

Example readback, after choosing a date in the page. Clerk accepts only session tokens minted for the page's origin, so `readback` makes the GET from the signed-in browser and prints only the response JSON, ready for a file or `python3 -m json.tool`:

```sh
"$CONTROL" readback "$RUN_ID" /v1/days/2026-09-25 > "$EVIDENCE/day.json"
```

## Cleanup

The helper closes only this run's browser, stops only its recorded app process and database container, deletes its Clerk test user, and removes its runtime directory, including the Clerk secret copy and raw Playwright snapshots. It never touches `$EVIDENCE`.

```sh
"$CONTROL" cleanup "$RUN_ID"
test -d "$EVIDENCE"
```

Run cleanup after failed attempts too. Never kill by process name or use `playwright cli close-all`.

## Helpers

`control-nouri` is executable. Its interface is `control-nouri {launch|doctor|sign-in-url|cleanup} RUN_ID`, `control-nouri readback RUN_ID /v1/PATH`, or `control-nouri browser RUN_ID PLAYWRIGHT_COMMAND [ARGS...]`; the commands above invoke each action. It uses an existing local `postgres:16-alpine` image. Docker may pull that image if it is absent.

`ean-y4m` is executable too: `ean-y4m 13-DIGIT-CODE OUT.y4m` writes an EAN-13 barcode as a Y4M video for Chrome's fake camera. [Barcode lookup](features/barcode.md) uses it for the camera scan.
