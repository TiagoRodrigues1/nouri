# Wearable import: sleep, workouts, and daily activity

## Problem

A Fitbit Air records sleep, workouts, steps, active energy, and heart rate, and the phone app uploads them to Google Health. Nouri shows sleep and workouts in the Overview Sleep and Activity sections next to entries logged by hand; the Activity section also holds the daily totals. The import must be repeatable. A second sync may not duplicate a record. A record Google corrects must update in place, and a record deleted in Google must leave Nouri. Google Health is the first source, but Apple Health and Health Connect will follow. The code therefore separates what every source shares from what only Google does.

## Shape

```
src/wearables/            provider-neutral
  contract.ts             provider list, import kinds, connection status, sync results (shared with the page)
  import-sync.ts          applyBatch: dedupe, revise, revive, delete; one store per kind's table
  provider.ts             CloudProvider interface, the record type of each kind, SyncWindow, the OAuth callback path
  connections.ts          sign-in state, PKCE, encrypted tokens, sync runner and its lease, disconnect
  sync-queue.ts           syncQueue: one job per connection, app-open refresh, reconciliation, retries, and the worker it wakes
  sync-timing.ts          every delay: the sync lease, Sync now's cooldown, debounce, staleness, reconciliation, retries
  routes.ts               integration routes, OAuth callback, and the webhook receiver
  token-vault.ts           AES-256-GCM token storage
src/google-health/        one CloudProvider
  config.ts               env settings and runtime construction
  google.ts               Google's endpoints, errors, paging for any data type
  data-point.ts           offsets, durations, and device names every data point shares
  sleep-import.ts         Google sleep data point -> SleepRecord
  workout-import.ts       Google exercise data point -> WorkoutRecord
  daily-import.ts         daily rollups and resting heart rate -> ActivityRecord, HeartRateRecord
  webhook.ts              Google's change notifications -> which kinds changed and from which date
  contract.ts             Google's response schemas, one scope per import kind
src/daily-totals/         the Overview's reader for imported daily totals
```

Each provider imports *kinds*: `sleep`, `workouts`, `activity`, and `heartRate`. Sleep and workouts are sessions. Activity (steps and active energy) and heart rate (the resting rate and the day's average, lowest, and highest) are totals per local day. A provider exposes one `pull` per kind, and `grantedKinds(scope)` says which ones a grant covers. A sync pulls every granted kind with one access token, then applies them all in one transaction, so either every kind lands or none does. The sync flow, the counts, and the Wearables dialog loop over `importKinds`, so they name no kind.

Cloud pulls end at `applyBatch(tx, kind, owner, window, batch)`. A batch contains the records inside the window and whether the list is complete. A record missing from a complete snapshot is deleted. The rules live once in `applyBatch`. A small `ImportStore` per kind knows only its table: what identifies a record, which rows the window covers, and how to insert, replace, and remove them. Device change feeds will get their own applier when an adapter uses them.

Daily totals go through the same `applyBatch`. A day's totals have no ID of their own, and the local date is their identity: the store keys them by date. Their rows live in `daily_activity` and `daily_heart_rate`, one per user, local date, and provider. They are not journal entries. Nobody edits them, nothing refers to them, and a returning day is inserted again, so they carry no revision and are deleted outright. A day without data has no row, so the Overview reads `null`, never zero. Activity and heart rate are separate kinds and tables because they need different scopes. A grant without heart rate keeps syncing activity and leaves imported heart rate alone. When two providers hold the same day, the Overview shows the one that changed last.

The window is a `SyncWindow`: sleep is read by when it ended (`endedSince`), and workouts and daily totals by local date (`days`, from `from` up to, not including, `until`), because Google filters exercise only on civil start time. `days.until` is two days past today's UTC date, so today is in the window in every time zone. The deletion scope uses the same bound as the provider's filter. Otherwise a record just outside the filter would look deleted.

For daily totals we also considered a second applier that replaces whole days in one long `(metric, date, value)` table. `applyBatch` already has the rules a daily snapshot needs: insert, update when the fingerprint changes, and delete what a complete window left out. A second applier would repeat them, and a key-value table would move each metric's checks out of the schema.

We considered two other shapes. A separate `pullWorkouts` and `applyWorkoutBatch` would copy the dedupe, revival, and deletion rules for every new kind. A single `imported_records` table would make every reader, such as the Overview, the workout summary, and the targets, union imports with the manual tables. Keeping imports in the journal tables means imported workouts count toward the day's totals with no reader changes.

Imports live in `sleep_sessions` and `workouts` with `source` set to the provider. They keep the provider's ID (`source_id`), its fingerprint and device. `(user_id, source, source_id)` is unique and includes deleted rows. A record the provider brings back therefore revives its old row instead of creating a second one. Every change bumps the Nouri `revision`, like manual records. A record is unchanged when its fingerprint matches. The fingerprint hashes the provider update time, when present, and the session fields, so a correction without a new revision still lands.

Google gives UTC offsets, not zone names. An imported night's `timeZone` is the offset where it ended, such as `-04:00`, and a workout's is the offset where it started. That offset also decides which local date the record belongs to. Manual entries keep their IANA zone.

Imported sleep and workouts are outside the manual delete path, so deleting their IDs returns `404`. The provider owns those rows and the next sync applies its changes. The row shows its device and service, and the page shows an Imported badge instead of a delete button. Imported workouts also keep the provider's name for the session (`source_title`, such as "Evening Run"). Nouri's six activities are coarser than Google's list, so the page shows that name instead of the activity label.

## Google Health specifics

- Endpoint: `GET https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints`, with `filter=sleep.interval.end_time >= "<RFC 3339>"`. Pages hold at most 25 points and are followed through `nextPageToken`. Sources: the [dataPoints.list reference](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list) and the [sleep guide](https://developers.google.com/health/data-types/sleep).
- Exercise endpoint: `GET https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints`, with `filter=exercise.interval.civil_start_time >= "<YYYY-MM-DD>"`. Exercise has no physical end-time filter. Pages hold at most 25 points. Source: the [workouts guide](https://developers.google.com/health/data-types/workouts).
- Scopes: `https://www.googleapis.com/auth/googlehealth.sleep.readonly` for sleep, `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly` for workouts, steps, and active energy, and `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly` for heart rate, and nothing else, per the [scope list](https://developers.google.com/health/scopes). A person can untick any of them on the consent screen. Nouri stores the granted scope and pulls only those kinds. A grant with none is revoked and reported as `missing-scope`. A connection made before a kind existed lacks its scope. It keeps syncing the rest, and the Wearables dialog asks for **Connect again** to add it.
- Daily totals: `POST https://health.googleapis.com/v4/users/me/dataTypes/{steps,active-energy-burned,heart-rate}/dataPoints:dailyRollUp` with a civil date `range` and `windowSizeDays: 1`. Each bucket is one local day: `steps.countSum` (an int64 string), `activeEnergyBurned.kcalSum`, and `heartRate.beatsPerMinuteAvg`, `Min`, and `Max`. A day without data comes without a value, or without a bucket. Google rolls up at most 14 days of heart rate per request and 90 of the others, so heart rate is read in pieces. The steps list endpoint carries no counts, so only the rollup works. Source: the [dailyRollUp reference](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/dailyRollUp).
- Resting heart rate: `GET .../dataTypes/daily-resting-heart-rate/dataPoints` with `filter=daily_resting_heart_rate.date >= "<YYYY-MM-DD>"`. Each point has `dailyRestingHeartRate.date` and `beatsPerMinute`.
- Daily values outside what Nouri stores become unknown: steps above 200,000, active energy above 20,000 kcal, and heart rates outside 20 to 250 bpm. The day's average, lowest, and highest are dropped together when one is out of range or they are out of order. A day left with no value is counted as skipped. A rollup bucket or resting heart rate point Nouri cannot read fails the sync as unavailable instead: dropping it would delete or blank a day already stored. Sessions differ, and an unreadable session is skipped. Rollups carry no update time, so a day's fingerprint hashes its values, and today's partial totals update on every sync.
- OAuth: authorization code with PKCE (S256), `access_type=offline`, `prompt=consent`, and `include_granted_scopes=false`. Endpoints come from Google's [data access guide](https://developers.google.com/health/migration/data-access). Access tokens last an hour and are refreshed before use.
- Sync window: 30 days. A full sync re-reads the window and reconciles it. A background import may read less; see below. A deletion older than the window is not seen.
- Unlinked accounts: a Google account without a Google Health profile gets `400` with reason `ACCOUNT_NOT_LINKED` from identity and data requests. Google asks apps to check the identity right after sign-in and not show such an account as connected, so the callback revokes the grant and reports `not-linked`. A connected account that later reports it asks for a new sign-in. Source: [troubleshooting](https://developers.google.com/health/troubleshooting).
- Identity: `GET https://health.googleapis.com/v4/users/me/identity` returns `healthUserId`, the ID notifications name the person by. Any of Nouri's read scopes may call it, so no new consent is needed. Nouri reads it after each sign-in and stores it as `provider_user_id`. When that read fails, the next sync fills it in.
- Stages: for `STAGES` sleep, `summary.stagesSummary` minutes map to awake, light, deep, and REM. The code falls back to adding up the stage intervals. `CLASSIC` sleep (asleep and restless) imports without stages. Points that do not parse, or that are not 0–24 hours long, are counted as skipped.
- Workouts: `exerciseType` maps onto Nouri's six activities. Running, walking, cycling, swimming, and strength types map to their group; everything else becomes `other`, and the `displayName` keeps the detail. Duration is `activeDuration`, which leaves out pauses, or the whole interval when that is missing. Distance comes from `metricsSummary.distanceMillimeters` and energy from `caloriesKcal`. Strength workouts never carry a distance. A value outside what a Nouri workout stores becomes unknown. A session under a minute or over 24 hours is skipped.
- A sync stops after 40 pages per kind. When that cap is hit, it imports what it read but deletes nothing and says so.

## Background imports

Nobody needs to press **Sync now**. Three triggers queue imports, and one worker in the server process runs them.

1. **Webhooks**, when `GOOGLE_HEALTH_WEBHOOK_SECRET` is set. Google posts to `POST /webhooks/google-health` when a person's sleep, exercise, steps, heart rate, or resting heart rate changes. Nouri maps each notification's `healthUserId` to its connections, its `dataType` to a kind, and its interval to the earliest UTC date that changed, one day early because a local date can lead UTC. It queues a job due 30 seconds later. One phone upload sends several notifications within seconds, and they all merge into that job. Active energy has no notification type. It changes with steps, and the activity pull reads both.
2. **Opening Nouri.** The page calls `POST /v1/integrations/{provider}/refreshes` on load, on window focus, and every five minutes while visible. It shows the stored data at once and does not wait. The server queues a job only when the last sync is stale and no job is waiting. With webhooks, data counts as stale after 6 hours, so this only catches what notifications missed. Without webhooks, as on localhost, it counts as stale after 15 minutes, and opening the page is what imports. The job reads every kind from three days before the last sync, so late uploads still land. When the last reconciliation is more than a day old, the job re-reads the whole window instead. The page checks every 3 seconds while a job is pending. When `lastSyncedAt` moves, the page reloads the Overview.
3. **Reconciliation.** Every 6 hours the worker queues a full re-read for connections that were opened in the last 14 days and not reconciled in the last 24 hours, spread over ten minutes. It catches notifications that never arrived and deletions that a narrow read cannot see. People who stopped using Nouri are not polled. Their next app open re-reads the window.

`wearable_sync_jobs` holds at most one job per connection. A new request merges into the waiting job: the kinds add up, the earliest date wins, and the sooner due time wins. That is the deduplication. The worker reads due jobs and runs them one at a time. It calls `sync(scope)`, the same sync and `applyBatch` that Sync now uses, with the window narrowed to the job's date and kinds. Jobs have no lock of their own: one worker runs per server, and the connection's sync lease (below) keeps two syncs off one connection. The deletion scope uses the same narrowed window as the provider's filter, so a narrow import deletes only what it read. A job counts the requests merged into it. If one arrives while a worker runs the job, the count moves, the job stays, and it runs again.

A failure Google may recover from (unreachable, 429, 5xx) retries after 1, 2, 4, … 256, then 360 minutes, each with jitter between half and all of the delay, so it keeps trying through an outage of several hours. A new notification does not cut a retry short. After 11 failures, about 14 hours at most, the job is dropped. The connection's `lastError` says why, and the next app open or reconciliation tries again. A revoked grant drops the job at once.

One sync runs per connection at a time. A sync takes a lease, `sync_started_at`, before it calls Google, and releases it when it finishes. A lease older than 15 minutes no longer counts, which covers a full read at its worst: 40 pages per kind at 20 seconds a request. While a sync runs, only the lease holder may write to the connection: its records, its refreshed tokens, and its failure. A sync that outlives its lease, or one still running when the person signs in again, therefore saves nothing and cannot clear the new grant. Signing in clears the lease for that reason. A grant that has never had a full read, such as one just signed in, gets one on its next sync whatever the job asked, because a sign-in may have switched accounts or added kinds. **Sync now** is also refused within a minute of the last sync, unless the grant is new since then. It answers `429` with `Retry-After` and reads nothing. A background job that finds a sync running waits 30 seconds, and the wait does not count as a failure. The **Sync now** button waits while a background import is pending.

Costs stay low because each notification batch becomes one narrow read, an app open with fresh data reads nothing, and reconciliation runs once a day only for active people. The database scales to zero when idle, so the worker never polls it. Every job is queued in the server process, so the worker sets a timer for the next due job and wakes when a request queues one. With nothing queued it sets no timer, and only the reconciliation scan touches the database, 4 times a day. A notification carries no data. It only says what to re-read from Google, so a forged one could cost at most one sync. The webhook still checks the secret.

### Registering the webhook

Webhooks need a public HTTPS endpoint, so only a deployed Nouri can use them. Register a subscriber once per Google Cloud project, with the project number rather than the project ID. The secret goes in `endpointAuthorization.secret` with the `Bearer ` prefix:

```sh
curl -X POST "https://health.googleapis.com/v4/projects/$PROJECT_NUMBER/subscribers?subscriberId=nouri" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
  -d '{
    "endpointUri": "https://<your host>/webhooks/google-health",
    "subscriberConfigs": [{ "dataTypes": ["sleep", "exercise", "steps", "heart-rate", "daily-resting-heart-rate"], "subscriptionCreatePolicy": "AUTOMATIC" }],
    "endpointAuthorization": { "secret": "Bearer '"$GOOGLE_HEALTH_WEBHOOK_SECRET"'" }
  }'
```

Google checks the endpoint first. A request with the secret must get `200`, and one without it must get `401`. Nouri does both once the secret is set and the server restarted. `AUTOMATIC` covers everyone who consents, now and later. It sends nothing from before the subscriber existed, which the first full sync after connecting covers. To rotate the secret, `PATCH ...?updateMask=endpointAuthorization` with the new one after Nouri accepts it. Nouri accepts one secret at a time, so expect a few minutes of `401` retries, which Google redelivers. Nouri does not check the `GOOGLE-HEALTH-API-SIGNATURE` header. The secret authenticates the sender, and a notification carries no data. Source: [Google Health webhooks](https://developers.google.com/health/webhooks).

## Security

- Tokens are sealed with `WEARABLE_TOKEN_KEY` (AES-256-GCM). The provider, user, and column are bound in as associated data. They are never returned by the API, logged, or put in error messages.
- CSRF: `POST /v1/integrations/{provider}/authorizations` is bearer-protected. It stores a one-time state (hashed, 10-minute lifetime) and sets the same value in an `HttpOnly; SameSite=Lax` cookie scoped to the callback path. The callback accepts only a state that matches the cookie and an unexpired stored row, and it deletes the row on use. A link crafted by someone else lacks the cookie and connects nothing.
- The callback sends `Referrer-Policy: no-referrer` and redirects to `/overview?connect=<provider>&result=<outcome>`. The page reports the outcome and removes the parameters.
- If the person unticks sleep on Google's consent screen, Nouri revokes the partial grant and reports `missing-scope`.
- The callback arrives by browser redirect without a session token. It connects the user who stored the matching state, and only if the cookie proves this browser started that sign-in.

## Failure handling

| Situation | What Nouri does |
| --- | --- |
| Access token refused (401) | Refreshes once and retries |
| Refresh fails with `invalid_grant`, or a 403 | Status `reauthorize`, tokens dropped, imports kept, tile says **Connect again** |
| Google unreachable, 429, or 5xx | `502` with the reason; still connected; last successful sync unchanged. A background job retries with backoff |
| Sync now pressed during a sync, or within a minute of the last | `429` with `Retry-After`; nothing read from Google |
| A webhook without the secret | `401`; nothing queued |
| A notification Nouri cannot read, or for someone it does not know | `204`, ignored, so Google does not resend it for a week |
| Disconnect | Revokes the refresh token, removes imported nights and workouts, forgets tokens; reports if Google did not confirm the revocation |

## Adding a provider

- **Another cloud service** that uses OAuth: add its ID to `wearableProviders` and to the `source` checks of `sleep_sessions`, `workouts`, `daily_activity`, and `daily_heart_rate` in `db/schema.sql`. Implement `CloudProvider`: its authorization URL, code exchange, refresh, `grantedKinds`, revoke, and a `pull` for each kind that returns its records. Register it in the runtime configuration from its env settings, and add its name to `frontend/src/lib/wearables.ts`. Routes, the callback, the state cookie, token storage, the Wearables dialog, and the Overview tiles are already generic.
- **Another kind**: add it to `importKinds`, give it a record type in `ImportRecords`, and add an `ImportStore` for its table in `import-sync.ts`. The compiler then asks for its key in the API schemas, each provider's `pull` and scope, and the page's names for it.
- **Apple Health or Health Connect**: the data lives on the phone, so a native app would read it and upload changes. Add the provider ID and a bearer-protected route such as `POST /v1/wearable-imports`. An explicit changes applier belongs with that route when a device adapter exists. `CloudProvider` does not apply there.

## Automated tests

`tests/integration/google-health.test.ts` and `tests/integration/google-health-daily.test.ts` run the real app against PostgreSQL. `tests/fake-google.ts` stands in for Google. It serves the documented shapes from `src/google-health/fixtures/` and checks client credentials, the redirect URI, and PKCE. It also serves daily rollups and resting heart rate from a map of days, and refuses rollups longer than Google allows. The subtests cover first import of sleep and workouts, repeated import, correction, deletion and revival, token refresh, an outage, a revoked grant, reconnect, a sleep-only grant, disconnect, and CSRF rejections. The daily test covers first import, the rollup pieces, repeat, correction, deletion and return, unreadable days, an incomplete read, days older than the window, a grant without heart rate, and disconnect. `tests/unit/wearables.test.ts` covers the exercise and daily mappings.

`tests/integration/google-health-background.test.ts` drives the queue with a fake clock. It covers webhook verification, one narrow import from a burst of notifications, a notification during a run, app-open refresh with and without webhooks, retries with backoff, dropping a job after its last attempt, reconciliation, a revoked grant, disconnect, the Sync now cooldown, one sync at a time per connection, a lapsed sync lease, and a worker that sets no timer while nothing is queued.

`tests/fake-google-server.ts` runs the app with the same fixtures, for driving the page in a browser without a Google account. A sync there proves Nouri's handling of fixtures. It is not a live connection.

## Live setup

These steps need your Google account and cannot be scripted from this repository.

1. **Account.** The Fitbit Air must sync to a personal Google account in the Fitbit or Google Health app on the iPhone. Google Workspace accounts are not supported by the Google Health API. Fitbit Web API tokens do not carry over.
2. **Google Cloud project.** In the [Google Health API setup](https://developers.google.com/health/setup), create or pick a project and enable the **Google Health API**.
3. **Consent screen.** Configure the OAuth consent screen as External in **Testing**, and add your Google account under **Audience → Test users**. On **Data Access**, add `.../auth/googlehealth.sleep.readonly`, `.../auth/googlehealth.activity_and_fitness.readonly`, and `.../auth/googlehealth.health_metrics_and_measurements.readonly`. Google classifies Health API scopes as restricted. A Testing app used only by its listed test users (up to 100) does not need the security review. Google may show an "unverified app" screen; continue, since it is your own project.
4. **OAuth client.** Create a **Web application** client. Add the authorized redirect URI `http://127.0.0.1:3000/oauth/google-health/callback`, plus `http://127.0.0.1:5173/oauth/google-health/callback` if you use `pnpm dev`. Copy the client ID and secret.
5. **Nouri.** Put the four settings from the README in `.env`, run `pnpm db:migrate`, then `pnpm build:web && pnpm dev:api`. Open `http://127.0.0.1:3000/overview`, not `localhost`, so the host matches the redirect URI.

In Testing mode Google expires refresh tokens after 7 days. After that, Sync reports that access expired and the tile offers **Connect again**. Moving the consent screen to Production removes the 7-day limit but requires Google's verification for restricted scopes.

## Testing with the Fitbit Air and iPhone

1. Wear the Fitbit Air overnight. In the morning, open the Fitbit / Google Health app on the iPhone, let it sync, and wait until the night appears with stages. Stage processing can lag; a later sync picks it up.
2. In Nouri, choose **Wearables** in the sidebar, then **Connect**, sign in with the same Google account, and allow sleep, activity, and health metrics. If you connected before Nouri imported workouts or heart rate, the dialog asks you to **Connect again** first. After the redirect Nouri syncs once and shows a toast with the count.
3. Go to the morning's date. The night appears with `Google Fitbit Air · Google Health` and an Imported badge. Compare its start, end, and stage minutes with the phone app. Times show in the browser's zone; the API readback (`GET /v1/overview/<date>`) shows the source offset.
4. **Workout:** record a workout on the Fitbit Air, such as a run, and let the phone sync it. **Sync now** reports 1 new workout. On the day it started, **Overview → Activity** lists it in Workouts under its Google name with `Google Fitbit Air · Google Health` and an Imported badge. Compare duration, distance, and calories with the phone app. Nouri's duration is active time, so pauses are left out.
5. **Activity:** on a day you wore the Fitbit Air, **Overview → Activity** shows the day's steps against your steps target, active energy, and resting heart rate with the day's average and range. Compare them with the phone app. Today's totals grow with each sync.
6. **Repeat:** choose **Sync now**. The session count stays the same. The toast says "No changes", or only that a day of activity or heart rate updated, since today's totals keep growing.
7. **Correction:** edit that night's times in the phone app and let it sync. Then **Sync now**: the toast reports 1 updated, and the session shows the new times. Its `revision` in the API readback goes up by one.
8. **Deletion:** delete a sleep log or an exercise in the phone app and let it sync. **Sync now** reports 1 removed, and the record leaves Nouri.
9. **Authorization failure:** remove Nouri under [Google Account → Third-party connections](https://myaccount.google.com/connections), then **Sync now**. The Wearables dialog and the Overview tiles show **Sign in again** with the reason, and imported nights stay. **Connect again** resumes.
10. **Disconnect:** choose **Disconnect** and confirm. Imported nights, workouts, and daily totals disappear, manual entries stay, and Nouri no longer appears in your Google Account connections.

If a step differs from what is described here, note the toast text and the Wearables dialog's error line. Save `GET /v1/integrations/google-health` too; it never contains tokens.
