# Food journal web app

## Usage

Open `/`, connect with the API token, choose a day, search the Ciqual catalog or enter a food manually, then review, edit, log again, or delete the day's entries on the timeline. `/food` redirects to `/`. The selected date and token persist for the current browser tab.

## Structure

- `frontend/src/router.tsx` defines the Today and Overview routes with TanStack Router.
- `frontend/src/views.tsx` owns the day query and the food and water mutations. The Today view's water card logs 250 ml, 500 ml, or a custom amount and lists the day's water entries. `connection-dialog.tsx` owns the token form, and `log-food-dialog.tsx` owns search and food entry forms. TanStack Query invalidates the selected day after a mutation.
- `frontend/src/overview.tsx` is the Overview route. Tabs filter the sections: Sports, Measurements, and Sleep. Food, water, and supplements appear only on Today. It reads `GET /v1/overview/{date}` and owns the mutations for measurements, workouts, sleep, and progress photos. `overview-dialogs.tsx` contains their forms. Photos load as blobs with the bearer token and display through object URLs, so the page's CSP allows `blob:` images.
- `frontend/src/lib/api.ts` adds the bearer token and parses responses with the shared schemas in `src/food/contract.ts`. The server remains responsible for nutrient calculation, totals, revisions, and idempotency receipts.
- `frontend/src/components/ui` contains local StyleX controls, using Radix where interaction needs it.
- `frontend/src/theme.stylex.ts` defines theme tokens in one StyleX variable group. The default accent is slate blue. Component styles use StyleX, while `frontend/src/reset.css` contains global browser resets.
- Vite builds into `web/dist`. Hono serves the built page and assets from the same origin as `/v1`, with no browser CORS setup.

## Decision

The earlier page used plain browser JavaScript and three hand maintained static files. React and TanStack now provide explicit UI state, navigation, query caching, and mutation refreshes. The same origin API and session token flow stay in place, so the backend contracts do not change. Each piece of data has one home. Today shows what you eat, drink, and take: the food timeline, daily totals, water, and supplements. The page header is the date alone, with no breadcrumb or eyebrow repeating the sidebar. The sidebar lists the two pages, then Targets, Supplements, and Wearables under Settings; Wearables is managed only from its dialog. The Overview adds workouts, body measurements, sleep, and progress photos. Wearable data stays a placeholder until the backend imports it.

## Next steps

Add each future journal area with a real API route and its own view. Keep the sidebar entries tied to working data, and add new theme colors through the StyleX variables instead of component specific values.
