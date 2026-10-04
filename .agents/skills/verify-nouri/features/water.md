# Log water

Stay on today's date and capture a screenshot of `section[aria-label="Water"]`, which shows progress and the drinks list but no add controls. Choose `+ Log`, then `Water`. The dialog opens with `#water-ml` at `250`; choose `Save water`. Open it again, choose `Bottle, 500 ml`, and save. Open it a third time, fill `#water-ml` with `330`, and press Enter. Each save closes the dialog and shows `Water saved.` The bottle display should read `1,080 ml` and the `Logged water` list should have three rows. Read `GET /v1/days/<today>` and assert `water.entryCount` is 3 and `water.totalMl` is 1080.

Choose the delete button whose accessible name starts with `Delete 500 ml of water`, reload the page, and check that the bottle display reads `580 ml` with two rows. Read the day again and confirm `water.totalMl` is 580. An empty day returns `water.totalMl: null` and the bottle display shows `0 ml`.
