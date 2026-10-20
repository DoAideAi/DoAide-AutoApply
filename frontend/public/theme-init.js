// Applies the saved theme before first paint so dark-mode users don't see a
// white flash while the bundle loads. Mirrors src/lib/theme.js.
(function () {
  try {
    var p = localStorage.getItem("autoapply-theme");
    var dark =
      p === "dark" ||
      (p !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    if (dark) root.classList.add("dark");
    root.style.colorScheme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0A0A0B" : "#FFFFFF");
  } catch (e) {
    // Storage blocked: fall back to the light theme.
  }
})();
