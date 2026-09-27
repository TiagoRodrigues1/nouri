---
name: verify-nouri
description: Verify Nouri's food journal web page and API through an isolated local PostgreSQL instance and a real browser. Use after changes to food search, food or water logging, food edits, daily totals, date navigation, deletion, My Day cards, targets, supplements (the list and daily ticks on My Day or Overview), or the Overview page (measurements, workouts, sleep, supplements, progress photos).
---

# Verify Nouri

Read [features/README.md](features/README.md) and the relevant feature file before driving Nouri. The web page at `/` is the primary user interface. The same server exposes `/v1` endpoints and `/openapi.json`; use the API to confirm stored side effects.

## Launch

Run from the repository root. Docker, `pnpm`, `pg_isready`, `curl`, Python 3, OpenSSL, and `playwright cli` must be on `PATH`. Dependencies are described in the root and `frontend/package.json` files; run `pnpm install` if `node_modules` is absent. The helper starts a disposable `postgres:16-alpine` container on a random localhost port, applies `db/schema.sql`, and starts `src/server.ts` on another free localhost port. Each run gets its own token and user UUID.

The server serves the built page from `web/dist`. `launch` refuses to start when that build is missing or older than `frontend/index.html` or the TypeScript and CSS under `frontend/src` and `src` (the page imports its contracts from `src`). Run `pnpm build:web` first. The helper does not build for you, because rebuilding replaces assets under any other run serving the same `web/dist`.

```sh
RUN_ID="nouri-$(date +%s)-$$"
CONTROL=.agents/skills/verify-nouri/control-nouri
"$CONTROL" launch "$RUN_ID"
source "/tmp/nouri-verify-$RUN_ID/env"
EVIDENCE="/tmp/nouri-verification-evidence/$RUN_ID"
mkdir -p "$EVIDENCE"
```

The helper prints `Healthy Nouri run ...` when the page, OpenAPI document, authenticated day request, server process, and database answer. It records its own process and container IDs under `/tmp/nouri-verify-$RUN_ID`. Keep the shell variables for the entire drive. Two runs with different IDs use separate databases, ports, tokens, and browser sessions. Never drive an instance started by somebody else.

## Doctor

Run this read-only check first whenever the instance looks wrong. It requires the original app PID and database container ID, checks PostgreSQL readiness, confirms the page and OpenAPI title/version, and makes an authenticated day request with this run's token.

```sh
"$CONTROL" doctor "$RUN_ID"
```

## Drive

Use the helper's `browser` action, which runs `playwright cli` in this run's scratch directory with session `nouri-$RUN_ID`. Playwright's automatic snapshots stay there and disappear during cleanup. Use the selectors and accessible names in the feature map. Open the page to load the journal.

```sh
"$CONTROL" browser "$RUN_ID" open "$NOURI_BASE_URL/"
"$CONTROL" browser "$RUN_ID" snapshot | sed "s/$API_TOKEN/[REDACTED]/g"
```

The token is a secret. Do not put `env`, browser storage, request headers, or unredacted `fill` output into evidence. Redact token text from snapshots before displaying or saving them. Use `"$CONTROL" browser "$RUN_ID" run-code 'async (page) => { ... }'` for assertions with Playwright locators when a snapshot is ambiguous. Do not set app state through `page.evaluate` or call internal functions to create the state under test.

## Evidence

Save proof under `$EVIDENCE`; cleanup never removes it. For each feature, record the feature ID and entry point, a screenshot or redacted page snapshot before the user action, the browser action, and the resulting screen. `"$CONTROL" browser "$RUN_ID" screenshot --filename "$EVIDENCE/before.png"` and the same command with `after.png` save screenshots directly. For text proof, pipe `snapshot` through `sed "s/$API_TOKEN/[REDACTED]/g"` before writing it to `$EVIDENCE`.

For a mutation, save an authenticated readback from the endpoint that owns the result: `GET /v1/days/<date>` for food, water, and supplement intakes, `GET /v1/supplement-stack/<date>` for the supplement list, `GET /v1/overview/<date>` for Overview records, or `GET /v1/dashboard` for card layout. Assert the relevant entries and totals. This is a second read of persisted state, not a substitute for the browser action. Search proof should show query, results or empty state, and source attribution. Follow real page controls. Do not use internal setters or test-only endpoints. Mock only a production boundary that already exists; the default Nouri run uses the real local database. Nouri has no dry-run mode. If a future recipe uses one, inspect actual files, network activity, and database state to establish what it skips.

Example readback, after choosing a date in the page:

```sh
curl -fsS -H "Authorization: Bearer $API_TOKEN" "$NOURI_BASE_URL/v1/days/2026-09-25" > "$EVIDENCE/day.json"
```

## Cleanup

The helper closes only this run's browser, stops only its recorded app process and database container, and removes its runtime directory, including the token and raw Playwright snapshots. It never touches `$EVIDENCE`.

```sh
"$CONTROL" cleanup "$RUN_ID"
test -d "$EVIDENCE"
```

Run cleanup after failed attempts too. Never kill by process name or use `playwright cli close-all`.

## Helpers

`control-nouri` is executable. Its interface is `control-nouri {launch|doctor|cleanup} RUN_ID` or `control-nouri browser RUN_ID PLAYWRIGHT_COMMAND [ARGS...]`; the commands above invoke each action. It uses an existing local `postgres:16-alpine` image. Docker may pull that image if it is absent.
