# Data export

Log something first (a glass of water is enough) so the export has rows to check. Choose `Open user menu`. Clerk's panel lists `Manage account`, `Download my data`, and `Sign out`. Choose `Download my data` and wait for the browser's download event; the file is named `nouri-export-<today>.json`. Save it with Playwright's `download.saveAs` into `$EVIDENCE`.

The file has `"format": "nouri-export/1"`, the account's `id`, and a `tables` object with one array per table that holds the person's rows (`food_entries`, `water_entries`, `mutation_receipts`, `progress_photos`, and the rest). The logged water appears in `water_entries`, and its retry receipt appears in `mutation_receipts`. `wearable_connections` rows never contain `refresh_token` or `access_token`. Photo `image` values are base64.

Account deletion is not driven in the browser. It starts in Clerk and reaches Nouri as a signed `user.deleted` webhook, which needs the Clerk instance to reach the run's server. `tests/integration/account.test.ts` covers erasure through the webhook route.
