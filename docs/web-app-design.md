# Food journal web app

## Usage

Open `/`, connect with the API token, choose a day, search the Ciqual catalog or enter a food manually, then review or delete the day's entries. The `/food` route keeps the same food data in a focused journal view. The selected date and token persist for the current browser tab.

## Structure

- `frontend/src/router.tsx` defines the Today and Food routes with TanStack Router.
- `frontend/src/views.tsx` owns the day query and food mutations. `connection-dialog.tsx` owns the token form, and `log-food-dialog.tsx` owns search and food entry forms. TanStack Query invalidates the selected day after a mutation.
- `frontend/src/lib/api.ts` adds the bearer token and parses responses with the shared schemas in `src/food/contract.ts`. The server remains responsible for nutrient calculation, totals, revisions, and idempotency receipts.
- `frontend/src/components/ui` contains local StyleX controls, using Radix where interaction needs it.
- `frontend/src/theme.stylex.ts` defines theme tokens in one StyleX variable group. The default accent is slate blue. Component styles use StyleX, while `frontend/src/reset.css` contains global browser resets.
- Vite builds into `web/dist`. Hono serves the built page and assets from the same origin as `/v1`, with no browser CORS setup.

## Decision

The earlier page used plain browser JavaScript and three hand maintained static files. React and TanStack now provide explicit UI state, navigation, query caching, and mutation refreshes. The same origin API and session token flow stay in place, so the backend contracts do not change. The interface shows only food data because the backend has no water, movement, or sleep endpoints yet.

## Next steps

Add each future journal area with a real API route and its own view. Keep the sidebar entries tied to working data, and add new theme colors through the StyleX variables instead of component specific values.
