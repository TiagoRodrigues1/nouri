# Log water

Stay on today's date and capture a screenshot of `section[aria-label="Water"]`, which shows progress, three quick-add tiles, and the drinks list. Press `Ctrl+K` and choose `Add water` (see [command-palette.md](command-palette.md)). Press Enter on `Glass` (250 ml). Open it again and choose `Bottle` (500 ml). Open it a third time, type `330`, and press Enter on `Add 330 ml`. Each save closes the palette and shows `Water saved.` Alternatively, type `330 water` at the palette's root instead of the third save; it logs the same 330 ml in one step. The bottle display should read `1,080` ml (the number and `ml` are separate elements, so match the number; its text content is `1,080ml`) and the `Logged water` list should have three rows. Read `GET /v1/days/<today>` and assert `water.entryCount` is 3 and `water.totalMl` is 1080.

Choose the delete button whose accessible name starts with `Delete 500 ml of water`, reload the page, and check that the bottle display reads `580` with two rows. Read the day again and confirm `water.totalMl` is 580. An empty day returns `water.totalMl: null` and the bottle display shows `0`.

## Quick-add tiles

Start with no drinks on today's date. If the palette recipe above has run, delete its remaining drinks and confirm the day readback has `water.entryCount` 0 before continuing.

The card has three tiles named `Log 250 ml of water`, `Log 500 ml of water`, and `Log 1000 ml of water`. Hovering one shows a dashed line on the bottle and a hint under the tiles such as `→ 13% of your goal`, or `→ reaches your goal` once the drink would meet it. The hint line is reserved while empty, so the card's height must not change between idle, hover, and after the pointer leaves. Choose the 250, 500, and 1000 tiles in turn, waiting for each to be enabled again (they are disabled while a save is in flight). Each tap shows `Water saved.` and a `+250`-style label that floats up from the tile. The bottle display should read `1,750` with three rows, and `GET /v1/days/<today>` should report `water.entryCount` 3 and `water.totalMl` 1750. At a 390 px wide viewport the tiles stay three across beneath the bottle.
