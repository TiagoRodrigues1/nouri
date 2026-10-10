# Wearable import (Google Health)

The sidebar's `Wearables` item opens a dialog with a `Google Health` panel. Its state badge reads `Not set up`, `Not connected`, `Connected`, or `Sign in again`. `Not set up` shows setup guidance without import counts or action buttons. The other states show `Last successful sync` and one row per kind (`Imported sleep`, `Imported workouts`, `Imported steps and active energy`, `Imported heart rate`) counting sleep sessions, workouts, days of activity, and days of heart rate, plus an error line after a failed attempt. `Not connected` offers `Connect`; `Connected` offers `Sync now` and `Disconnect` (plus `Connect again` and a `Nouri cannot read …` note when Google granted only some kinds); `Sign in again` offers `Connect again` and `Disconnect`.

The default `control-nouri launch` run has no Google settings. There, check that the dialog reads `Not set up` and explains that settings go in `.env`.

To drive Connect without a Google account, start the fixture-backed app on the run's database. This replaces only the Google and Open Food Facts HTTP boundaries, so check [barcode lookup](barcode.md) on the default run. The checked-in fixture records are dated September 24, 2026, and sync reads only the previous 30 days. The import assertions below require those records to remain in the sync window. Once they age out, refresh the fixture dates before using this recipe to judge import behavior.

Start it in a subshell, as `launch` starts the app. Backgrounding `setsid` from the top-level shell lets it fork, so `$!` would record a parent that exits at once while the server keeps running.

```sh
source "/tmp/nouri-verify-$RUN_ID/env"
PORT2=<free port>
(CLERK_AUTHORIZED_PARTIES="http://127.0.0.1:$PORT2" PORT=$PORT2 \
  setsid node --import tsx tests/fake-google-server.ts > "/tmp/nouri-verify-$RUN_ID/fake-google.log" 2>&1 &
  echo $! > "/tmp/nouri-verify-$RUN_ID/fake-google-pid")
```

Sign the browser in on that port; the sign-in link works on any origin the app is served from:

```sh
"$CONTROL" browser "$RUN_ID" open "$("$CONTROL" sign-in-url "$RUN_ID" | sed "s#$NOURI_BASE_URL#http://127.0.0.1:$PORT2#")"
```

In the browser, route `https://accounts.google.com/**` to a 302 back to the request's `redirect_uri`. The `run-code` sandbox has no `URL`, so split the query string by hand. Include the same `state` and `code=4/fake-approved-<code_challenge>`. Choosing `Connect` then lands on `/overview` and syncs. On 2026-09-24 the list shows `03:40 – 11:25` in Europe/Lisbon, `7 h 45 min · Google Fitbit Air · Google Health`, and a 45-minute nap, both with an `Imported` badge and no delete button. Manual sleep keeps its `Delete sleep …` button. The Sports list on the same date shows `Evening Run` (`22:30 · 40 min · 8.02 km · 512 kcal · Google Fitbit Air · Google Health`) and `Weights` (`02:00 · 50 min · 240 kcal · …`), each with an `Imported` badge. The weights started at 21:00 at -04:00, so they belong to 2026-09-24 even though Lisbon time is past midnight. `GET /v1/overview/2026-09-24` shows `sports.entries[].source` with `kind: "wearable"` and `title`, and `sports.entryCount` 2. Its `sleep.sessions[]` show `source.kind: "wearable"`, `timeZone: "-04:00"`, and the night's stages. The fixture server also seeds daily totals. On 2026-09-24 the Overview's `Activity` tab shows `9,037 steps` against the `10,000 goal`, `413 kcal` active energy, and `58 bpm resting` with `Average 72 bpm` and `Range 48–161 bpm`. On 2026-09-26 only `60 bpm resting` shows, with `No steps imported for this day.` A day with nothing reads `—` in each tile with both "No … imported" lines. `GET /v1/overview/2026-09-24` shows `activity` and `heartRate` with `provider: "google-health"`. `Sync now` then toasts `Google Health synced. No changes.` `Disconnect` opens a `Disconnect Google Health?` dialog (role `dialog`, not `alertdialog`) listing every imported count; its `Disconnect` button removes the imported sleep, workouts, and daily totals, leaves manual ones, and turns `activity` and `heartRate` to `null`.

For CSRF, open `/oauth/google-health/callback?state=forged&code=x`. The page toasts `That sign-in link expired or was opened in another browser…` and `GET /v1/integrations/google-health` still reports `connection: "not-connected"` (the dialog badge reads `Not connected`).

Evidence from this path is fixture-backed; never report it as a live Google sync. Before `control-nouri cleanup`, stop the fixture server's process group with `kill -- "-$(cat "/tmp/nouri-verify-$RUN_ID/fake-google-pid")"` and check that nothing listens on `$PORT2`.
