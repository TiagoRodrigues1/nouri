# Barcode lookup

Entry points: typing a barcode into `#search-query`, and the `Scan` button beside `Search`, both in the `Search foods` tab of `+ Log` > `Food`. The meal editor's `Add food` panel has the same picker in its `Search` tab, where a ticked result joins `Foods in this meal` instead of the selection (see [Meals](saved-meals.md)); ticking `5449000000996` there adds the product at `330`, one serving, with its Open Food Facts `catalogRef`. The run's server asks the live Open Food Facts API, so the machine needs internet access. Results can change when Open Food Facts edits a product.

Typed lookup: fill `#search-query` with `3017620422003` and press Enter. `Food search results` shows `Nutella` with `Nutella · per 100 g · 539 kcal`, and the dialog links `Source: Open Food Facts, available under the Open Database License`. Tick it, fill its amount in `Selected foods` with `15`, and check that its line starts with `81 kcal`. Choose `Log 1 food`. The timeline shows Nutella at 15 g. `GET /v1/days/<date>` has `catalogRef` `{"provider":"open-food-facts","id":"3017620422003"}` with a `version` and `kcal: 80.85`.

A drink: `5449000000996` shows `Coca-Cola Original`, with the brand before `per 100 ml` (`COCA-COLA SERVICES SA/NV · per 100 ml · 42 kcal …`). Ticking it adds it to `Selected foods` at one serving, `330` ml. Logging stores `{"unit":"ml","amount":330}` and `kcal: 139.92`.

Error states, all in the tab's message area:

- `3017620422004` (wrong check digit) shows `That barcode's numbers don't add up. Check it and try again.` and sends no request.
- `96385074` (unknown) and `4000000000006` (a product with no name) show `No product with this barcode yet. Add it from the label, and others who scan it will find it.` and an `Add this product` button (see [Community foods](community-foods.md))

Editing a scanned entry with `Edit <name>` uses the manual edit form, with the amount in the product's unit (`Amount in millilitres` for the drink). Saving 165 ml of the Coca-Cola entry stores `kcal: 69.96`, keeps the Open Food Facts reference, and moves the entry to revision 2.

Camera scan: the browser needs a fake camera. The skill's `ean-y4m` helper writes an EAN-13 barcode as a Y4M video (white 640×480 frames, 5 px per module) into the run's directory. Then reopen this run's session with a config that feeds it:

```sh
R=/tmp/nouri-verify-$RUN_ID
.agents/skills/verify-nouri/ean-y4m 5449000000996 "$R/ean.y4m"
cat > "$R/cam.config.json" <<JSON
{ "browser": { "browserName": "chromium", "launchOptions": { "channel": "chrome", "args": ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=$R/ean.y4m"] }, "contextOptions": { "permissions": ["camera"] } } }
JSON
"$CONTROL" browser "$RUN_ID" close
"$CONTROL" browser "$RUN_ID" open --config "$R/cam.config.json" "$("$CONTROL" sign-in-url "$RUN_ID")"
```

Choose `Scan`. A video labelled `Camera view for barcode scanning` appears below `#search-query`. Within a second the video closes, `#search-query` reads `5449000000996`, and the Coca-Cola result appears. The console shows no CSP error for the `zxing_reader-*.wasm` asset.
