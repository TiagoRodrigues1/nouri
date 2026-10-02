# Account access

On a fresh run, open `/` before using `sign-in-url`. The page shows Clerk's `Continue to nouri` form with email, password, and Google sign-in choices; the journal is hidden. An unauthenticated `GET /v1/days/<date>` returns 401.

Open the run's single-use `sign-in-url` in its browser session. The My Day timeline appears, and `Open user menu` shows the test user's address. Keep the link, token, cookies, and browser storage out of evidence. The helper's authenticated `readback` action can now read the day.

Choose `Open user menu`, then `Sign out` in Clerk's account panel. The page returns to `Continue to nouri`, and `GET /v1/days/<date>` again returns 401 in that signed-out browser. Capture the signed-out page and a redacted signed-in snapshot. Sign out last when combining this recipe with other features in one run.
