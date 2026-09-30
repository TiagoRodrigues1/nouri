# Supplements

Stay on today's date. The `section[aria-label="Supplements"]` card on My Day should say `No supplements on your list for this day.`

Open the sidebar `Supplements` button. In the dialog, choose `Add supplement` twice. Fill the first row as `Vitamin D3`, dose `2000`, and the `Dose unit` combobox `IU`. Fill the second row as `Creatine monohydrate`, the `Type` combobox `Creatine`, dose `5`, and unit `g`. Choose `Save supplements`. The dialog closes and the card lists both rows, with `2,000 IU · Vitamin` and `5 g · Creatine`.

Choose `Mark Creatine monohydrate as taken` (its tick button). The card should read `1 of 2 taken` and the button changes to show the time. Read `GET /v1/days/<today>` and assert that `supplements.items` has two entries and that creatine has one intake with dose `{ amount: 5, unit: "g" }`. Choose the `Unmark …` button: the tick button returns, the card reads `0 of 2 taken` and the day readback has no intakes. Choose `Previous day`. The card shows the empty state, because the list takes effect from the day it was saved.

Overview has no Supplements section; ticking happens only on My Day.
