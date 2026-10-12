# Theme

The moon or sun button beside the account menu is named for the appearance it will switch to: `Dark theme` on a light page, `Light theme` on a dark page. Capture the page, choose `Dark theme`, and confirm the palette changes and the button becomes `Light theme`. Reload and confirm dark appearance persists, then choose `Light theme` and confirm the reverse. The choice is stored in this browser, across accounts.

Without a saved choice, the page follows the system appearance at first load and when it changes. Use a fresh isolated browser session with no saved theme, emulate light appearance, and reload. Emulate dark appearance and confirm the page follows. Choose light explicitly, change the emulated system appearance again, and confirm the saved choice wins. Restore the original preference after this check.

At 390 px wide, the same control sits beside the avatar in the top bar. Toggle it there and capture the result. With reduced motion emulated, switching uses a short fade instead of the circular reveal. Confirm the palette still changes, then restore the viewport and motion preference.
