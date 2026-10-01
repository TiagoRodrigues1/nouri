# Review

Seed a week through the API: two foods on one day, a food without protein on another, a workout, a night that ends on a third day, and a weight on a fourth. Choose the `Review` sidebar link. The heading reads `Last 7 days`, the `Seven-day review` table lists the seven days oldest first, and the line above it reads `Records on 5 of 7 days`. Days with no record of a kind have empty cells, not zeros. The day whose food lacks protein shows `Incomplete` under Protein. The night shows on the day it ends. The `Days recorded` footer counts days per column.

Choose `Open <day> in Today`. Its link contains `?date=<day>`, and Today opens on that date with its foods, including after reload. Press Back and check that the same week is shown. Choose `Open <day> in Overview` for the weighed day; its link also contains `?date=<day>`, and the Weight tile shows the value after navigation or reload. Return to Review and choose `Previous week`. The URL gains `?to=<date>`, the heading shows the range, and the rows move back seven days. Open `Choose the last day of the week`: the calendar opens on the month containing the selected last day, and the seven days of the week are shaded. Choosing another day moves the week to end there. Opening a day from there and pressing Back returns to that week.

Read `GET /v1/review/<date>` and assert `from`, the seven `days`, the null metrics on unrecorded days, and `recordedDays`.

From an earlier Review window, choose `+ Log` > `Food`. The dialog must name the window's last day. Log a manual food and read `GET /v1/days/<window-end>` to confirm it landed there, then compare that day's calories and protein with `GET /v1/review/<window-end>`.
