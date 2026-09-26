# Log water

Stay on today's date. In `section[aria-label="Water"]`, capture a screenshot, then choose `Add glass of water, 250 ml` and `Add bottle of water, 500 ml`. Fill `#water-ml` with `330` and press Enter. The bottle display should read `1,080 ml` and the `Logged water` list should have three rows. Read `GET /v1/days/<today>` and assert `water.entryCount` is 3 and `water.totalMl` is 1080.

Choose the delete button whose accessible name starts with `Delete 500 ml of water`, reload the page, and check that the bottle display reads `580 ml` with two rows. Read the day again and confirm `water.totalMl` is 580. An empty day returns `water.totalMl: null` and the bottle display shows `0 ml`.
