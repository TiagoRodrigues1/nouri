# Nouri

The first runnable slice records food entries and returns a daily food summary. PostgreSQL stores the entries and retry receipts. The React app uses TanStack Router and Query, with local shadcn components, to search, log, view, and delete food.

## Run locally

Start the local PostgreSQL container with `docker compose up -d db`. Its data persists in the `nouri_postgres-data` Docker volume. Stop it with `docker compose down` when you are done. The container binds only to localhost and uses the development credentials in `compose.yaml`.

Copy `.env.example` to `.env` and set a bearer `API_TOKEN` of at least 32 characters. The app and migration commands load `.env` automatically. Shell environment variables take precedence over values in the file.

```sh
pnpm install
docker compose up -d db
cp .env.example .env
# Edit API_TOKEN in .env before starting the server.
pnpm db:migrate
pnpm dev
```

The API listens on `127.0.0.1:3000` by default. `PORT` and `HOST` change it. Keep `HOST` on a loopback address: the web page includes `API_TOKEN`, so anyone who can load the page can use the API. The OpenAPI document is at `/openapi.json`.

Open `http://localhost:3000/` to use the web app. `pnpm dev` builds the frontend before starting the API and serving it on the same origin. The server adds `API_TOKEN` from `.env` to the page, so the app connects without asking for it. `pnpm dev:web` does the same for the Vite dev server.

For frontend development, run `pnpm dev:web` in another terminal and open the Vite URL. Vite proxies `/v1` requests to the API on port 3000. Run `pnpm build:web` before starting the API directly with `src/server.ts` or running the integration test.

Theme colors are in `frontend/src/theme.stylex.ts`. Change `primary`, `accent`, `sidebarActive`, and `feature` there to retheme the app without editing components. Component styles use StyleX; `frontend/src/reset.css` contains only global browser resets.

Food search uses the pinned [Ciqual 2025 dataset](https://doi.org/10.57745/RDMHWY), published by Anses under Etalab Open Licence 2.0. Search names are French or English; Portuguese names are not available in this catalog. The response includes source attribution. To regenerate the checked-in catalog from the official dataset, run `python3 scripts/import-ciqual.py`.

```sh
curl -X POST http://localhost:3000/v1/food-entries \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Idempotency-Key: create-oats-1' \
  -H 'Content-Type: application/json' \
  -d '{"occurredAt":"2026-09-24T12:30:00Z","timeZone":"Europe/Lisbon","food":{"name":"Oats","quantity":{"amount":80,"unit":"g"},"nutrients":{"kcal":311,"proteinG":13,"carbsG":53,"fatG":5}}}'

curl http://localhost:3000/v1/days/2026-09-24 \
  -H "Authorization: Bearer $API_TOKEN"

curl 'http://localhost:3000/v1/foods/search?q=apple&locale=en' \
  -H "Authorization: Bearer $API_TOKEN"
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

## Verify

`pnpm typecheck` and `pnpm lint` run without a database. `pnpm test:integration` needs `DATABASE_URL` for PostgreSQL and a built frontend. The test creates and removes its own schema.
