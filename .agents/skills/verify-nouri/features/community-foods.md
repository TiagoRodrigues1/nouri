# Community foods

Entry points: `Add this product` under a barcode miss in the `Search foods` tab of `+ Log` > `Food` (and the meal editor's `Search` tab), and `Share with other Nouri users` in the `Add manually` tab. The run's server asks the live Open Food Facts API, so use `96385074`, which it does not know.

Barcode miss: fill `#search-query` with `96385074` and press Enter. The message reads `No product with this barcode yet. Add it from the label, and others who scan it will find it.` Choose `Add this product`. The form shows `Barcode 96385074. Type its label below.` Fill `#food-name` `Bolo de arroz`, `#food-brand` `Pastelaria Aurora`, `#manual-kcal` `410`, `#manual-protein` `6`, `#manual-carbs` `55`, `#manual-fat` `18`, `#manual-serving` `80`, `#manual-amount` `80`, and choose `Add to selection`. `Selected foods` lists it at 80 g; choose `Log 1 food`. The timeline shows `Bolo de arroz` at 80 g, 328 kcal; `GET /v1/days/<date>` has `catalogRef` `{"provider":"nouri","id":"<uuid>"}`.

Found again: searching `bolo`, or `96385074` again, lists `Bolo de arroz` first with `User-added · Pastelaria Aurora · per 100 g · 410 kcal`. Ticking the barcode result adds it at the serving, `80` g.

Manual sharing: in `Add manually`, choose `100 ml` in `Label is per`, tick `Share with other Nouri users`, and log. The hint reads `It joins Nouri's foods. Others find it once it's reviewed.` The entry carries a `nouri` reference. Unticked, the entry has `catalogRef: null` and no community food is stored.

Review: other users find a food only after review. List the run database's `community_foods` rows with `docker exec nouri-verify-$RUN_ID sh -c 'psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}" -c "select name, barcode, reviewed_at from community_foods"'`; new rows have no `reviewed_at`. With the run's `DATABASE_URL`, `pnpm foods:review` lists them, and `pnpm foods:review approve <id>` shares one.
