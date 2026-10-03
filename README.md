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

Food search uses the pinned [Ciqual 2025 dataset](https://doi.org/10.57745/RDMHWY), published by Anses under Etalab Open Licence 2.0. Search names are French or English; Portuguese names are not available in this catalog. The response includes source attribution. To regenerate the checked-in catalog from the official dataset, run `python3 scripts/import-ciqual.py`.

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
```

Choose a search result and send its `ref` with a quantity in grams. The server calculates and stores the portion nutrients, including `null` for missing values.

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

Use `PATCH /v1/food-entries/{id}` with a full replacement body and `If-Match: "<revision>"` to edit. Use `DELETE` at the same path with the same revision header to remove. Each intended mutation needs a new `Idempotency-Key`; reuse the key and request when retrying. The day endpoint groups entries by the local date in each entry's recorded time zone. It returns `null` for an empty or incomplete nutrient total.

A saved meal copies the foods of chosen entries at chosen amounts, so a usual breakfast logs in one request. `POST /v1/saved-meals` with `{"name":"Breakfast","items":[{"entryId":"<id>","amount":60}]}` saves one, and `GET /v1/saved-meals` lists them. `POST /v1/saved-meals/{id}/logs` with `occurredAt`, `timeZone`, and `items` of `{"id":"<item id>","amount":…}` logs the listed items at that time, scaling each saved food's nutrients to the amount. The response is `{"entries":[…]}`. Items left out are not logged. `PATCH /v1/saved-meals/{id}` with `If-Match` and `{"name":…,"items":[{"id":"<item id>","amount":…}]}` renames the meal and sets its usual amounts. Items left out are removed. Delete a meal with `DELETE` and `If-Match`, and the foods already logged from it stay. [docs/saved-meals-design.md](docs/saved-meals-design.md) and [docs/saved-meal-editing-design.md](docs/saved-meal-editing-design.md) explain the design.

Water uses the same retry and revision rules. Log a drink in whole millilitres, from 1 to 5,000:

```sh
curl -X POST http://localhost:3000/v1/water-entries \
  -H "Authorization: Bearer $NOURI_TOKEN" \
  -H 'Idempotency-Key: water-1' \
  -H 'Content-Type: application/json' \
  -d '{"occurredAt":"2026-09-24T09:00:00Z","timeZone":"Europe/Lisbon","volumeMl":250}'
```

Remove one with `DELETE /v1/water-entries/{id}` and `If-Match: "<revision>"`. The day response has a `water` object with `entries`, `entryCount`, and `totalMl`. `totalMl` is `null` when nothing was logged, so an unrecorded day is not reported as zero.

Run `pnpm db:migrate` on a fresh database. It applies `db/schema.sql`, which holds the whole database schema. The app is not deployed yet, so change that file directly instead of adding migrations. To apply schema changes to an existing local database, recreate it with `docker compose down -v` and `docker compose up -d db`, then run `pnpm db:migrate` again. This deletes local data.

`GET /v1/review/{date}` returns calories, protein, workout minutes, sleep minutes, and weight for the seven local days ending on the date, oldest first, with `recordedDays` counting the days that have each kind of record. A day without a record of a kind reads `null`, never zero. Food totals are also `null` when a logged food lacks the value, and `food.entryCount` tells the two apart. Weight is the last one recorded that day and does not carry forward. The web app shows it on the Review page. [docs/review-design.md](docs/review-design.md) explains the design.

`GET /v1/dashboard` returns the cards shown on My Day, in display order. Until the user saves a layout, it returns the defaults: `totals`, `water`, `mix`, and `activity`. `PUT /v1/dashboard` with `{"cards":[...]}` replaces the whole layout; a card left out is hidden. The other cards are `fasting`, `largest`, and `meals`.

`GET /v1/overview/{date}` feeds the Overview page. It groups the day into `nutrition` (the day's food and water), `sports` (workouts), `measurements`, `sleep`, and `photos`. Log records with `POST /v1/measurements`, `POST /v1/workouts`, and `POST /v1/sleep-sessions`, and remove them with `DELETE` and `If-Match`, following the same retry rules as water.

- A measurement is a `kind` of `weight` (kg), `height` (cm), `body-fat` (%), or `waist` (cm) with a `value`. It carries forward: the overview shows the latest value recorded on or before the date. It also returns a 30-day weight history, the change since the previous weight, and a BMI from the latest weight and height.
- A workout has an `activity`, `durationMinutes`, and optional `distanceM` and `energyKcal`. Strength workouts can include exercises with a name, sets, reps per set, and optional weight in kilograms. Strength workouts cannot have a distance. The day's `energyKcal` is `null` if any workout lacks an estimate.
- A sleep session has `startedAt`, `endedAt`, and optional `stages` in minutes (`awake`, `light`, `deep`, `rem`). It counts toward the local date on which it ends.

Upload a progress photo as multipart form data with `file`, `occurredAt`, and `timeZone`:

```sh
curl -X POST http://localhost:3000/v1/progress-photos \
  -H "Authorization: Bearer $NOURI_TOKEN" \
  -H 'Idempotency-Key: photo-1' \
  -F file=@progress.jpg -F occurredAt=2026-09-24T08:00:00Z -F timeZone=Europe/Lisbon
```

The server accepts JPEG, PNG, and WebP up to 8 MB. It identifies the type from the file's first bytes, not from its name. The bytes are stored in PostgreSQL. `GET /v1/progress-photos/{id}/image` returns them. Deleting a photo erases its bytes.

### Google Health sleep and workouts

The Overview Sleep section can import sleep and workouts from Google Health, which is where a Fitbit Air syncs through the phone app. Nouri's server signs in to Google with the read-only sleep and activity-and-fitness scopes and keeps the tokens encrypted in PostgreSQL. The page never sees them. Set these in `.env` and restart:

```sh
GOOGLE_HEALTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_HEALTH_CLIENT_SECRET=...
GOOGLE_HEALTH_REDIRECT_URI=http://127.0.0.1:3000/oauth/google-health/callback
WEARABLE_TOKEN_KEY=$(openssl rand -hex 32)   # paste the output, not the command
```

Open Nouri on the same host and port as the redirect URI; the sign-in cookie is tied to that host. For `pnpm dev`, register and use `http://127.0.0.1:5173/oauth/google-health/callback` instead; Vite forwards `/oauth` to the API. Choose **Wearables** in the sidebar, then **Connect**, approve sleep and exercise access, and Nouri runs a first sync. **Sync now** re-reads the last 30 days and adds, updates, or removes imported nights and workouts to match Google. Imported workouts appear in Sports under their Google name, such as "Evening Run", and count toward the day's workout totals. Imported records show their device and cannot be deleted in Nouri. Delete them in Google Health, then sync. **Disconnect** revokes Nouri's access and removes everything it imported. Manual sleep and workouts are kept. A connection made before workouts were imported reads only sleep; the Wearables dialog asks you to **Connect again** to add them.

The API is `GET /v1/integrations/google-health` for status, `POST .../authorizations` to start sign-in, `POST .../syncs`, and `DELETE /v1/integrations/google-health`. [docs/wearables-design.md](docs/wearables-design.md) covers the Google Cloud setup, testing with a real Fitbit Air and iPhone, and adding another provider.

## Verify

`pnpm typecheck` and `pnpm lint` run without a database. `pnpm test:integration` needs `DATABASE_URL` for PostgreSQL and a built frontend. The test creates and removes its own schema.
