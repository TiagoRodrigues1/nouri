# Nouri

The first runnable slice records food and water entries and returns a daily summary. PostgreSQL stores the entries and retry receipts. The React app uses TanStack Router and Query, with local shadcn components, to search, log, view, and delete food.

## Run locally

Start the local PostgreSQL container with `docker compose up -d db`. Its data persists in the `nouri_postgres-data` Docker volume. Stop it with `docker compose down` when you are done. The container binds only to localhost and uses the development credentials in `compose.yaml`.

Nouri signs people in with [Clerk](https://clerk.com). Create a Clerk application, copy `.env.example` to `.env`, and set `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` from the dashboard's API keys page. Use a development instance locally. `CLERK_AUTHORIZED_PARTIES` lists the origins that serve the web app; the server refuses session tokens minted for any other site, so add your production origin when you deploy. The app and migration commands load `.env` automatically. Shell environment variables take precedence over values in the file.

```sh
pnpm install
docker compose up -d db
cp .env.example .env
# Set the Clerk keys in .env before starting the server.
pnpm db:migrate
pnpm dev
```

The root `package.json` contains the API dependencies and commands. `frontend/package.json` contains the web app dependencies and its Vite commands. `pnpm install` at the root installs both packages through `pnpm-workspace.yaml`; they share one lockfile. Run `pnpm --dir frontend dev` or `pnpm --dir frontend build` when working on the web app alone.

The API listens on `127.0.0.1:3000` by default. `PORT` and `HOST` change it. The OpenAPI document is at `/openapi.json`.

Open `http://127.0.0.1:5173/` while developing the frontend. `pnpm dev` starts the API and Vite together. Vite updates the page when frontend files change and proxies `/v1` requests to the API on port 3000. Both servers add `CLERK_PUBLISHABLE_KEY` from `.env` to their pages, so one build works with any Clerk instance. The page shows Clerk's sign-in and sign-up until someone signs in.

Every `/v1` request needs a Clerk session token as a bearer token. The server creates a row in `users` the first time it sees a Clerk user, and every record belongs to that row's `id`. Session tokens expire after about a minute. For the `curl` examples below, sign in to the page and run `await Clerk.session.getToken()` in the browser console, then `export NOURI_TOKEN=<token>`.

Data logged before sign-in existed belongs to the old `API_USER_ID`. To keep it, link that id to your Clerk user (`user_…`, shown in the Clerk dashboard) before you first sign in: `INSERT INTO users (id, clerk_user_id) VALUES ('<old API_USER_ID>', '<clerk user id>');`.

The built page is also available at `http://localhost:3000/`. Run `pnpm build:web` before starting the API alone with `pnpm dev:api` or running the integration test.

Theme colors are in `frontend/src/theme.stylex.ts` for StyleX page styles and in the `:root` variables of `frontend/src/index.css` for the shadcn/ui components in `frontend/src/components/ui`; keep the two in sync. Add components with `pnpm dlx shadcn@latest add <name>` from `frontend/`. Page styles use StyleX and override component classes through `{...stylex.props(...)}`.

Food search uses the pinned [Ciqual 2025 dataset](https://doi.org/10.57745/RDMHWY), published by Anses under Etalab Open Licence 2.0. Search accepts French, English, and Portuguese words. A hand-curated glossary in `src/food/portuguese.ts` reads Portuguese words as the English words Ciqual uses, so `frango` finds chicken. Results keep the names Ciqual publishes, since the catalog has no Portuguese names. [docs/portuguese-search-design.md](docs/portuguese-search-design.md) explains why. The response includes source attribution. To regenerate the checked-in catalog from the official dataset, run `python3 scripts/import-ciqual.py`.

```sh
curl -X POST http://localhost:3000/v1/food-entries \
  -H "Authorization: Bearer $NOURI_TOKEN" \
  -H 'Idempotency-Key: create-oats-1' \
  -H 'Content-Type: application/json' \
  -d '{"occurredAt":"2026-09-24T12:30:00Z","timeZone":"Europe/Lisbon","food":{"name":"Oats","quantity":{"amount":80,"unit":"g"},"nutrients":{"kcal":311,"proteinG":13,"carbsG":53,"fatG":5}}}'

curl http://localhost:3000/v1/days/2026-09-24 \
  -H "Authorization: Bearer $NOURI_TOKEN"

curl 'http://localhost:3000/v1/foods/search?q=apple&locale=en' \
  -H "Authorization: Bearer $NOURI_TOKEN"

curl 'http://localhost:3000/v1/foods/search?q=peito%20de%20frango&locale=pt-PT' \
  -H "Authorization: Bearer $NOURI_TOKEN"
```

Choose a search result and send its `ref` with a quantity in grams. The server calculates and stores the portion nutrients, including `null` for missing values. Ciqual marks some amounts as `traces` or below a limit, such as `< 0,5`; the catalog reads those as 0 and half the limit, so only values Ciqual never measured (`-`) are `null`. A day's total for a nutrient is `null` when any food that day lacks it.

```json
{
  "occurredAt": "2026-09-24T12:30:00Z",
  "timeZone": "Europe/Lisbon",
  "food": {
    "kind": "catalog",
    "ref": { "provider": "ciqual", "id": "13039", "version": "2025" },
    "quantity": { "amount": 150, "unit": "g" }
  }
}
```

Use the `ref` returned by search. The example selects raw apple from the pinned dataset.

Packaged foods are found by barcode. `GET /v1/foods/barcodes/{code}` takes an EAN-8, UPC-A, EAN-13, or GTIN-14 with a valid check digit. It asks [Open Food Facts](https://world.openfoodfacts.org), whose data is available under the Open Database License, and returns the product's name, brand, serving size, and a `food` holding 100 g or 100 ml of it, with an `open-food-facts` reference. It answers 404 when Open Food Facts has no product with that code, and 502 when Open Food Facts does not answer. Log the product with the manual body, scaling `food` to the amount eaten. The web page does this from the **Search foods** tab, where you can type a barcode or choose **Scan** to read one with the camera. The camera needs HTTPS or localhost. [docs/barcode-lookup-design.md](docs/barcode-lookup-design.md) explains the design.

```sh
curl http://localhost:3000/v1/foods/barcodes/3017620422003 \
  -H "Authorization: Bearer $NOURI_TOKEN"
```

Use `PATCH /v1/food-entries/{id}` with a full replacement body and `If-Match: "<revision>"` to edit. Use `DELETE` at the same path with the same revision header to remove. Each intended mutation needs a new `Idempotency-Key`; reuse the key and request when retrying. The day endpoint groups entries by the local date in each entry's recorded time zone. It returns `null` for an empty or incomplete nutrient total.

A saved meal copies the foods of chosen entries at chosen amounts, so a usual breakfast logs in one request. `POST /v1/saved-meals` with `{"name":"Breakfast","items":[{"entryId":"<id>","amount":60}]}` saves one, and `GET /v1/saved-meals` lists them. `POST /v1/saved-meals/{id}/logs` with `occurredAt`, `timeZone`, and `items` of `{"id":"<item id>","amount":…}` logs the listed items at that time, scaling each saved food's nutrients to the amount. The response is `{"entries":[…]}`. Items left out are not logged. `PATCH /v1/saved-meals/{id}` with `If-Match` and `{"name":…,"items":[{"id":"<item id>","amount":…}]}` renames the meal and sets its usual amounts. Items left out are removed. Delete a meal with `DELETE` and `If-Match`, and the foods already logged from it stay. Each food a meal log adds carries a `mealLogId`, and the day lists the logs it holds in `mealLogs`. `DELETE /v1/meal-logs/{id}` removes every food that log added, including ones edited since. `GET /v1/saved-meals` lists meals most recently logged first; a meal never logged ranks by when it was saved, and daily fills do not count. [docs/meal-logs-design.md](docs/meal-logs-design.md) explains the design. [docs/saved-meals-design.md](docs/saved-meals-design.md) and [docs/saved-meal-editing-design.md](docs/saved-meal-editing-design.md) explain the design.

Water uses the same retry and revision rules. Log a drink in whole millilitres, from 1 to 5,000:

```sh
curl -X POST http://localhost:3000/v1/water-entries \
  -H "Authorization: Bearer $NOURI_TOKEN" \
  -H 'Idempotency-Key: water-1' \
  -H 'Content-Type: application/json' \
  -d '{"occurredAt":"2026-09-24T09:00:00Z","timeZone":"Europe/Lisbon","volumeMl":250}'
```

Remove one with `DELETE /v1/water-entries/{id}` and `If-Match: "<revision>"`. The day response has a `water` object with `entries`, `entryCount`, and `totalMl`. `totalMl` is `null` when nothing was logged, so an unrecorded day is not reported as zero.

`pnpm db:migrate` applies `db/schema.sql` once, then each file in `db/migrations` once, in name order, and records them in `schema_migrations`. It is safe to run on every start. Once a database holds real data, leave `db/schema.sql` as it is and add each change as a new numbered file, such as `db/migrations/0001-add-notes.sql`. Update `src/db/schema.ts` to match.

`GET /v1/review/{date}` returns calories, protein, workout minutes, sleep minutes, and weight for the seven local days ending on the date, oldest first, with `recordedDays` counting the days that have each kind of record. A day without a record of a kind reads `null`, never zero. Food totals are also `null` when a logged food lacks the value, and `food.entryCount` tells the two apart. Weight is the last one recorded that day and does not carry forward. The web app shows it on the Review page. [docs/review-design.md](docs/review-design.md) explains the design.

`GET /v1/dashboard` returns the cards shown on My Day, in display order. Until the user saves a layout, it returns the defaults: `totals`, `water`, `mix`, and `activity`. `PUT /v1/dashboard` with `{"cards":[...]}` replaces the whole layout; a card left out is hidden. The other cards are `fasting`, `largest`, and `meals`.

`GET /v1/overview/{date}` feeds the Overview page. It groups the day into `sports` (workouts), `measurements`, `sleep`, `activity`, `heartRate`, and `photos`. Log records with `POST /v1/measurements`, `POST /v1/workouts`, and `POST /v1/sleep-sessions`, and remove them with `DELETE` and `If-Match`, following the same retry rules as water.

- A measurement is a `kind` of `weight` (kg), `height` (cm), `body-fat` (%), or `waist` (cm) with a `value`. It carries forward: the overview shows the latest value recorded on or before the date. It also returns a 30-day weight history, the change since the previous weight, and a BMI from the latest weight and height.
- A workout has an `activity`, `durationMinutes`, and optional `distanceM` and `energyKcal`. Strength workouts can include exercises with a name, sets, reps per set, and optional weight in kilograms. Strength workouts cannot have a distance. The web page picks exercise names from a library: `GET /v1/exercises` lists the built-in catalog from the public-domain [Free Exercise DB](https://github.com/yuhonas/free-exercise-db), your custom exercises, and names you logged before. `POST /v1/exercises` with `{"name":…,"muscle":…,"equipment":…}` adds a custom exercise and answers 409 when an exercise already has that name. `DELETE /v1/exercises/{id}` with `If-Match` removes it. To regenerate the checked-in catalog, run `python3 scripts/import-exercises.py`. [docs/exercise-library-design.md](docs/exercise-library-design.md) explains the design. The Workouts page keeps routines (`GET`, `POST /v1/routines`, `PATCH` and `DELETE /v1/routines/{id}` with `If-Match`): exercises with a rep target per set, a number or a range. Starting one logs each set's weight and reps in the browser, and Finish saves it as one strength workout. [docs/workout-routines-design.md](docs/workout-routines-design.md) explains the design. The day's `energyKcal` is `null` if any workout lacks an estimate.
- A sleep session has `startedAt`, `endedAt`, and optional `stages` in minutes (`awake`, `light`, `deep`, `rem`). It counts toward the local date on which it ends.
- `activity` (`steps`, `activeKcal`) and `heartRate` (`restingBpm` and a `range` of `averageBpm`, `minBpm`, and `maxBpm`) come only from a connected wearable. Each is `null` on a day nothing was imported.

Upload a progress photo as multipart form data with `file`, `occurredAt`, and `timeZone`:

```sh
curl -X POST http://localhost:3000/v1/progress-photos \
  -H "Authorization: Bearer $NOURI_TOKEN" \
  -H 'Idempotency-Key: photo-1' \
  -F file=@progress.jpg -F occurredAt=2026-09-24T08:00:00Z -F timeZone=Europe/Lisbon
```

The server accepts JPEG, PNG, and WebP up to 8 MB. It identifies the type from the file's first bytes, not from its name. The bytes are stored in PostgreSQL. `GET /v1/progress-photos/{id}/image` returns them. Deleting a photo erases its bytes.

### Account deletion and data export

`GET /v1/account/export` returns every record Nouri stores for the account as one JSON file, including deleted entries and retry receipts. Photos are base64 inside it. The web app offers it as **Download my data** in the account menu.

People delete their account in Clerk's account panel. Clerk then sends `user.deleted` to `POST /webhooks/clerk`, and Nouri revokes any Google Health grant and deletes every row that belongs to the person. To set it up, enable account deletion in the Clerk dashboard, add a webhook endpoint at `<your origin>/webhooks/clerk` subscribed to `user.deleted`, and set `CLERK_WEBHOOK_SIGNING_SECRET` to its signing secret. The server will not start without that secret when `NODE_ENV=production`, as in the Docker image. Retry receipts are kept for 30 days. [docs/account-data-design.md](docs/account-data-design.md) explains the design.

### Google Health sleep, workouts, and activity

Nouri can import sleep, workouts, steps, active energy, and heart rate from Google Health, which is where a Fitbit Air syncs through the phone app. Nouri's server signs in to Google with the read-only sleep, activity-and-fitness, and health-metrics scopes and keeps the tokens encrypted in PostgreSQL. The page never sees them. Set these in `.env` and restart:

```sh
GOOGLE_HEALTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_HEALTH_CLIENT_SECRET=...
GOOGLE_HEALTH_REDIRECT_URI=http://127.0.0.1:3000/oauth/google-health/callback
WEARABLE_TOKEN_KEY=$(openssl rand -hex 32)   # paste the output, not the command
```

Open Nouri on the same host and port as the redirect URI; the sign-in cookie is tied to that host. For `pnpm dev`, register and use `http://127.0.0.1:5173/oauth/google-health/callback` instead; Vite forwards `/oauth` to the API. Choose **Wearables** in the sidebar, then **Connect**, approve sleep, activity, and health metrics access, and Nouri runs a first sync. **Sync now** re-reads the last 30 days and adds, updates, or removes imported nights, workouts, and daily totals to match Google. Imported workouts appear in the Overview's Activity section under their Google name, such as "Evening Run", and count toward the day's workout totals. The Overview's Activity section shows the day's steps against your steps target, active energy, and resting heart rate with the day's average and range. A day without them reads "—", never zero. Imported records show their device and cannot be deleted in Nouri. Delete them in Google Health, then sync. **Disconnect** revokes Nouri's access and removes everything it imported. Manual sleep and workouts are kept. A connection made before a kind was imported, such as heart rate, reads only the kinds it covers; the Wearables dialog asks you to **Connect again** to add the rest.

The API is `GET /v1/integrations/google-health` for status, `POST .../authorizations` to start sign-in, `POST .../syncs`, and `DELETE /v1/integrations/google-health`. [docs/wearables-design.md](docs/wearables-design.md) covers the Google Cloud setup, testing with a real Fitbit Air and iPhone, and adding another provider.

## Deploy

The `Dockerfile` builds one image that serves the page and the API. On start it runs pending migrations, then the server, so run a single instance. Set these on the host:

- `DATABASE_URL`, with `?sslmode=require` for a hosted database.
- `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` from a Clerk production instance, and `CLERK_AUTHORIZED_PARTIES=https://<your host>`.
- `NOURI_PUBLIC_URL=https://<your host>` for the MCP server.
- For Google Health, `GOOGLE_HEALTH_REDIRECT_URI=https://<your host>/oauth/google-health/callback` (registered in Google Cloud too), the client id and secret, and a new `WEARABLE_TOKEN_KEY`. Losing the key means everyone connects again.

The image listens on `0.0.0.0:3000`; set `PORT` if the host assigns one. The barcode camera needs HTTPS, which hosts provide.

## Verify

`pnpm typecheck` and `pnpm lint` run without a database. `pnpm test:integration` needs `DATABASE_URL` for PostgreSQL and a built frontend. The test creates and removes its own schema.

GitHub Actions runs these checks on pushes and pull requests, along with `pnpm test:unit` and `pnpm build:web`. The [CI workflow](.github/workflows/ci.yml) uses Node 26, the pnpm version from `package.json`, a frozen lockfile install, and a temporary PostgreSQL 16 database. It needs no repository secrets and can also be started manually from the Actions tab.

## Logging from Claude or ChatGPT

`/mcp` is an MCP server whose tools search foods and exercises; log a meal, a saved meal, a workout, water, supplements, sleep, and body measurements; edit any logged entry; change the supplement stack, targets, and saved meals; read a day; and delete an entry. Claude and ChatGPT sign in through Clerk's OAuth consent page, so turn on dynamic client registration under **OAuth applications** in the Clerk dashboard, then add `https://<your host>/mcp` as a custom connector. The sidebar's **Assistants** dialog lists the assistants you let in and disconnects one; that needs **Generate access tokens as JWTs** turned off in the same Clerk page, since Clerk cannot revoke JWT access tokens. Set `NOURI_PUBLIC_URL` when a proxy or tunnel hides the public origin from the server. [docs/mcp-design.md](docs/mcp-design.md) explains the design.
