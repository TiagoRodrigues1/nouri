# Wearable import (Google Health)

The sidebar's `Wearables` item opens a dialog with a `Google Health` panel. Its state badge reads `Not set up`, `Not connected`, `Connected`, or `Sign in again`. `Not set up` shows setup guidance without import counts or action buttons. The other states show `Last successful sync`, `Imported sleep`, and `Imported workouts`, plus an error line after a failed attempt. `Not connected` offers `Connect`; `Connected` offers `Sync now` and `Disconnect`; `Sign in again` offers `Connect again` and `Disconnect`.

The default `control-nouri launch` run has no Google settings. There, check that the dialog reads `Not set up` and explains that settings go in `.env`.

To drive Connect without a Google account, start the fixture-backed app on the run's database. This replaces only Google's HTTP boundary:

```sh
source "/tmp/nouri-verify-$RUN_ID/env"
PORT2=<free port>
setsid env CLERK_AUTHORIZED_PARTIES="http://127.0.0.1:$PORT2" PORT=$PORT2 \
  node --import tsx tests/fake-google-server.ts > "/tmp/nouri-verify-$RUN_ID/fake-google.log" 2>&1 &
echo $! > "/tmp/nouri-verify-$RUN_ID/fake-google-pid"
```

Sign the browser in on that port; the sign-in link works on any origin the app is served from:

```sh
"$CONTROL" browser "$RUN_ID" open "$("$CONTROL" sign-in-url "$RUN_ID" | sed "s#$NOURI_BASE_URL#http://127.0.0.1:$PORT2#")"
```

In the browser, route `https://accounts.google.com/**` to a 302 back to the request's `redirect_uri`. The `run-code` sandbox has no `URL`, so split the query string by hand. Include the same `state` and `code=4/fake-approved-<code_challenge>`. Choosing `Connect` then lands on `/overview` and syncs. On 2026-09-24 the list shows `03:40 – 11:25` in Europe/Lisbon, `7 h 45 min · Google Fitbit Air · Google Health`, and a 45-minute nap, both with an `Imported` badge and no delete button. Manual sleep keeps its `Delete sleep …` button. The Sports list on the same date shows `Evening Run` (`22:30 · 40 min · 8.02 km · 512 kcal · Google Fitbit Air · Google Health`) and `Weights` (`02:00 · 50 min · 240 kcal · …`), each with an `Imported` badge. The weights started at 21:00 at -04:00, so they belong to 2026-09-24 even though Lisbon time is past midnight. `GET /v1/overview/2026-09-24` shows `sports.entries[].source` with `kind: "wearable"` and `title`, and `sports.entryCount` 2. `GET /v1/overview/2026-09-24` shows `source.kind: "wearable"`, `timeZone: "-04:00"`, and the night's stages. `Sync now` then toasts `Google Health synced. No changes.` `Disconnect` opens a confirmation naming both imported counts; confirming removes the imported sleep and workouts and leaves manual ones.

For CSRF, open `/oauth/google-health/callback?state=forged&code=x`. The page toasts `That sign-in link expired or was opened in another browser…` and the status stays `not-connected`.

Evidence from this path is fixture-backed; never report it as a live Google sync. Kill the recorded fake-google PID before `control-nouri cleanup`.
