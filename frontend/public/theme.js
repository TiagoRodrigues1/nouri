// Sets the theme before first paint, so a dark page never flashes light; src/lib/theme.ts owns it after that.
(() => {
  const stored = localStorage.getItem("nouri.theme");
  const dark = stored ? stored === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;

  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  if (dark) document.querySelector('meta[name="theme-color"]').content = "#12171a";
})();
