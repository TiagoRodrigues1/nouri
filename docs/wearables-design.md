# Wearable sleep and workout import

## Problem

A Fitbit Air records sleep and workouts, the phone app uploads them to Google Health, and Nouri should show them in the Overview Sleep and Sports sections next to entries logged by hand. The import must be repeatable. A second sync may not duplicate a record. A record Google corrects must update in place, and a record deleted in Google must leave Nouri. Google Health is the first source, but Apple Health and Health Connect will follow. The code therefore separates what every source shares from what only Google does.

## Shape

```
src/wearables/            provider-neutral
  contract.ts             provider list, import kinds, connection status, sync results (shared with the page)
  import-sync.ts          applyBatch: dedupe, revise, revive, delete; one store per kind's table
  provider.ts             CloudProvider interface, SleepRecord, WorkoutRecord, SyncWindow, the OAuth callback path
  connections.ts          sign-in state, PKCE, encrypted tokens, sync runner, disconnect
  routes.ts               integration routes and OAuth callback
  token-vault.ts           AES-256-GCM token storage
src/google-health/        one CloudProvider
  config.ts               env settings and runtime construction
  google.ts               Google's endpoints, errors, paging for any data type
  data-point.ts           offsets, durations, and device names every data point shares
  sleep-import.ts         Google sleep data point -> SleepRecord
  workout-import.ts       Google exercise data point -> WorkoutRecord
  contract.ts             Google's response schemas, one scope per import kind
```

Each provider imports *kinds*: `sleep` and `workouts`. A provider exposes `pull.sleep` and `pull.workouts`, and `grantedKinds(scope)` says which ones a grant covers. A sync pulls every granted kind with one access token, then applies them all in one transaction, so either every kind lands or none does.

Cloud pulls end at `applyBatch(tx, kind, owner, window, batch)`. A batch contains the records inside the window and whether the list is complete. A record missing from a complete snapshot is deleted. The rules live once in `applyBatch`. A small `ImportStore` per kind knows only its table: which rows the window covers, and how to insert, replace, and remove them. Device change feeds will get their own applier when an adapter uses them.

The window is a `SyncWindow`: sleep is read by when it ended (`endedSince`), workouts by the local date they started (`startedOnOrAfter`), because Google filters exercise only on civil start time. The deletion scope uses the same bound as the provider's filter. Otherwise a record just outside the filter would look deleted.

We considered two other shapes. A separate `pullWorkouts` and `applyWorkoutBatch` would copy the dedupe, revival, and deletion rules for every new kind. A single `imported_records` table would make every reader, such as the Overview, the workout summary, and the targets, union imports with the manual tables. Keeping imports in the journal tables means imported workouts count toward the day's totals with no reader changes.

Imports live in `sleep_sessions` and `workouts` with `source` set to the provider. They keep the provider's ID (`source_id`), its fingerprint and device. `(user_id, source, source_id)` is unique and includes deleted rows. A record the provider brings back therefore revives its old row instead of creating a second one. Every change bumps the Nouri `revision`, like manual records. A record is unchanged when its fingerprint matches. The fingerprint hashes the provider update time, when present, and the session fields, so a correction without a new revision still lands.

Google gives UTC offsets, not zone names. An imported night's `timeZone` is the offset where it ended, such as `-04:00`, and a workout's is the offset where it started. That offset also decides which local date the record belongs to. Manual entries keep their IANA zone.

Imported sleep and workouts are outside the manual delete path, so deleting their IDs returns `404`. The provider owns those rows and the next sync applies its changes. The row shows its device and service, and the page shows an Imported badge instead of a delete button. Imported workouts also keep the provider's name for the session (`source_title`, such as "Evening Run"). Nouri's six activities are coarser than Google's list, so the page shows that name instead of the activity label.

## Google Health specifics

- Endpoint: `GET https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints`, with `filter=sleep.interval.end_time >= "<RFC 3339>"`. Pages hold at most 25 points and are followed through `nextPageToken`. Sources: the [dataPoints.list reference](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list) and the [sleep guide](https://developers.google.com/health/data-types/sleep).
- Exercise endpoint: `GET https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints`, with `filter=exercise.interval.civil_start_time >= "<YYYY-MM-DD>"`. Exercise has no physical end-time filter. Pages hold at most 25 points. Source: the [workouts guide](https://developers.google.com/health/data-types/workouts).
- Scopes: `https://www.googleapis.com/auth/googlehealth.sleep.readonly` and `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`, and nothing else, per the [scope list](https://developers.google.com/health/scopes). A person can untick either one on the consent screen. Nouri stores the granted scope and pulls only those kinds. A grant with neither is revoked and reported as `missing-scope`. A connection made before workouts has only the sleep scope. It keeps syncing sleep, and the tile asks for **Connect again** to add workouts.
- OAuth: authorization code with PKCE (S256), `access_type=offline`, `prompt=consent`, and `include_granted_scopes=false`. Endpoints come from Google's [data access guide](https://developers.google.com/health/migration/data-access). Access tokens last an hour and are refreshed before use.
- Sync window: 30 days. Each sync re-reads the window and reconciles it. Nouri does not use [webhooks](https://developers.google.com/health/webhooks) because they need a public HTTPS endpoint, and Nouri runs on localhost. A deletion older than the window is not seen.
- Stages: for `STAGES` sleep, `summary.stagesSummary` minutes map to awake, light, deep, and REM. The code falls back to adding up the stage intervals. `CLASSIC` sleep (asleep and restless) imports without stages. Points that do not parse, or that are not 0–24 hours long, are counted as skipped.
- Workouts: `exerciseType` maps onto Nouri's six activities. Running, walking, cycling, swimming, and strength types map to their group; everything else becomes `other`, and the `displayName` keeps the detail. Duration is `activeDuration`, which leaves out pauses, or the whole interval when that is missing. Distance comes from `metricsSummary.distanceMillimeters` and energy from `caloriesKcal`. Strength workouts never carry a distance. A value outside what a Nouri workout stores becomes unknown. A session under a minute or over 24 hours is skipped.
- A sync stops after 40 pages per kind. When that cap is hit, it imports what it read but deletes nothing and says so.

## Security

- Tokens are sealed with `WEARABLE_TOKEN_KEY` (AES-256-GCM). The provider, user, and column are bound in as associated data. They are never returned by the API, logged, or put in error messages.
- CSRF: `POST /v1/integrations/{provider}/authorizations` is bearer-protected. It stores a one-time state (hashed, 10-minute lifetime) and sets the same value in an `HttpOnly; SameSite=Lax` cookie scoped to the callback path. The callback accepts only a state that matches the cookie and an unexpired stored row, and it deletes the row on use. A link crafted by someone else lacks the cookie and connects nothing.
- The callback sends `Referrer-Policy: no-referrer` and redirects to `/overview?connect=<provider>&result=<outcome>`. The page reports the outcome and removes the parameters.
- If the person unticks sleep on Google's consent screen, Nouri revokes the partial grant and reports `missing-scope`.
- Nouri keeps its single-user model: the callback connects the configured `API_USER_ID`.

## Failure handling

| Situation | What Nouri does |
| --- | --- |
| Access token refused (401) | Refreshes once and retries |
| Refresh fails with `invalid_grant`, or a 403 | Status `reauthorize`, tokens dropped, imports kept, tile says **Connect again** |
| Google unreachable, 429, or 5xx | `502` with the reason; still connected; last successful sync unchanged |
| Disconnect | Revokes the refresh token, removes imported nights and workouts, forgets tokens; reports if Google did not confirm the revocation |

## Adding a provider

- **Another cloud service** that uses OAuth: add its ID to `wearableProviders` and to the `sleep_sessions.source` and `workouts.source` checks in `db/schema.sql`. Implement `CloudProvider`: its authorization URL, code exchange, refresh, `grantedKinds`, revoke, and a `pull` for each kind that returns `SleepRecord`s or `WorkoutRecord`s. Register it in the runtime configuration from its env settings, and add its name to `frontend/src/lib/wearables.ts`. Routes, the callback, the state cookie, token storage, the Wearables dialog, and the Overview tiles are already generic.
- **Another kind**, such as steps: add it to `importKinds`, give it a record type in `ImportRecords`, and add an `ImportStore` for its table in `import-sync.ts`. The compiler then asks each provider for its `pull`.
- **Apple Health or Health Connect**: the data lives on the phone, so a native app would read it and upload changes. Add the provider ID and a bearer-protected route such as `POST /v1/wearable-imports`. An explicit changes applier belongs with that route when a device adapter exists. `CloudProvider` does not apply there.

## Automated tests

`tests/integration/google-health.test.ts` runs the real app against PostgreSQL. `tests/fake-google.ts` stands in for Google. It serves the documented shapes from `src/google-health/fixtures/` and checks client credentials, the redirect URI, and PKCE. Its subtests cover first import of sleep and workouts, repeated import, correction, deletion and revival, token refresh, an outage, a revoked grant, reconnect, a sleep-only grant, disconnect, and CSRF rejections. `tests/unit/wearables.test.ts` covers the exercise mapping.

`tests/fake-google-server.ts` runs the app with the same fixtures, for driving the page in a browser without a Google account. A sync there proves Nouri's handling of fixtures. It is not a live connection.

## Live setup

These steps need your Google account and cannot be scripted from this repository.

1. **Account.** The Fitbit Air must sync to a personal Google account in the Fitbit or Google Health app on the iPhone. Google Workspace accounts are not supported by the Google Health API. Fitbit Web API tokens do not carry over.
2. **Google Cloud project.** In the [Google Health API setup](https://developers.google.com/health/setup), create or pick a project and enable the **Google Health API**.
3. **Consent screen.** Configure the OAuth consent screen as External in **Testing**, and add your Google account under **Audience → Test users**. On **Data Access**, add `.../auth/googlehealth.sleep.readonly` and `.../auth/googlehealth.activity_and_fitness.readonly`. Google classifies Health API scopes as restricted. A Testing app used only by its listed test users (up to 100) does not need the security review. Google may show an "unverified app" screen; continue, since it is your own project.
4. **OAuth client.** Create a **Web application** client. Add the authorized redirect URI `http://127.0.0.1:3000/oauth/google-health/callback`, plus `http://127.0.0.1:5173/oauth/google-health/callback` if you use `pnpm dev`. Copy the client ID and secret.
5. **Nouri.** Put the four settings from the README in `.env`, run `pnpm db:migrate`, then `pnpm build:web && pnpm dev:api`. Open `http://127.0.0.1:3000/overview`, not `localhost`, so the host matches the redirect URI.

In Testing mode Google expires refresh tokens after 7 days. After that, Sync reports that access expired and the tile offers **Connect again**. Moving the consent screen to Production removes the 7-day limit but requires Google's verification for restricted scopes.

## Testing with the Fitbit Air and iPhone

1. Wear the Fitbit Air overnight. In the morning, open the Fitbit / Google Health app on the iPhone, let it sync, and wait until the night appears with stages. Stage processing can lag; a later sync picks it up.
2. In Nouri, choose **Wearables** in the sidebar, then **Connect**, sign in with the same Google account, and allow sleep and exercise. If you connected before workouts were imported, the dialog asks you to **Connect again** first. After the redirect Nouri syncs once and shows a toast with the count.
3. Go to the morning's date. The night appears with `Google Fitbit Air · Google Health` and an Imported badge. Compare its start, end, and stage minutes with the phone app. Times show in the browser's zone; the API readback (`GET /v1/overview/<date>`) shows the source offset.
4. **Workout:** record a workout on the Fitbit Air, such as a run, and let the phone sync it. **Sync now** reports 1 new workout. On the day it started, **Overview → Sports** lists it under its Google name with `Google Fitbit Air · Google Health` and an Imported badge. Compare duration, distance, and calories with the phone app. Nouri's duration is active time, so pauses are left out.
5. **Repeat:** choose **Sync now**. The toast says "No changes" and the session count stays the same.
6. **Correction:** edit that night's times in the phone app and let it sync. Then **Sync now**: the toast reports 1 updated, and the session shows the new times. Its `revision` in the API readback goes up by one.
7. **Deletion:** delete a sleep log or an exercise in the phone app and let it sync. **Sync now** reports 1 removed, and the record leaves Nouri.
8. **Authorization failure:** remove Nouri under [Google Account → Third-party connections](https://myaccount.google.com/connections), then **Sync now**. The Wearables dialog and the Overview tiles show **Sign in again** with the reason, and imported nights stay. **Connect again** resumes.
9. **Disconnect:** choose **Disconnect** and confirm. Imported nights and workouts disappear, manual entries stay, and Nouri no longer appears in your Google Account connections.

If a step differs from what is described here, note the toast text and the Wearables dialog's error line. Save `GET /v1/integrations/google-health` too; it never contains tokens.

## Future work

- **Steps, active energy, and heart rate from wearables.** Nouri only imports `sleep` and `workouts` (`src/wearables/contract.ts`'s `importKinds`). These would need a new `ImportKind`, a record type in `ImportRecords`, and an `ImportStore`, per the "Adding a provider" section above. They likely need their own scopes and data types too: `activity` (steps) and possibly `heart_rate` sit under `activity_and_fitness.readonly`, while resting heart rate may need a separate scope. Unlike sleep and workouts, these are typically daily aggregates rather than discrete sessions, so `applyBatch`'s per-record dedupe and revival may not fit as-is; check the shape Google returns before reusing it unchanged.
