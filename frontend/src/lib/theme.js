// Theme preference: "system" follows the OS, "light" / "dark" pin it. The
// choice lives in localStorage; the resolved theme is the `dark` class on
// <html>, which flips the CSS-variable palette in doaide-theme.css.
// public/theme-init.js applies the same logic before first paint, so a
// dark-mode user doesn't see a white flash while the bundle loads — keep the
// two in step.

export const THEME_KEY = "autoapply-theme";
export const THEMES = ["system", "light", "dark"];
const CHANGE_EVENT = "autoapply-theme-change";
const THEME_COLOR = { light: "#FFFFFF", dark: "#0A0A0B" };

const darkQuery = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export function getThemePreference() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref = getThemePreference()) {
  if (pref === "light" || pref === "dark") return pref;
  return darkQuery()?.matches ? "dark" : "light";
}

export function applyTheme(pref = getThemePreference()) {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
  return resolved;
}

export function setThemePreference(pref) {
  if (!THEMES.includes(pref)) return;
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Private mode / blocked storage: the choice still applies for this visit.
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: pref }));
}

/**
 * Subscribe to preference changes (from any toggle on the page, or another
 * tab) and to OS theme changes while on "system". Returns an unsubscribe.
 */
export function subscribeTheme(callback) {
  const onStorage = (e) => {
    if (e.key === THEME_KEY) {
      applyTheme();
      callback();
    }
  };
  const mq = darkQuery();
  const onOs = () => {
    if (getThemePreference() === "system") {
      applyTheme("system");
      callback();
    }
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", onStorage);
  mq?.addEventListener?.("change", onOs);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
    mq?.removeEventListener?.("change", onOs);
  };
}
