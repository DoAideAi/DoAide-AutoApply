import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_KEY,
  applyTheme,
  getThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeTheme,
} from "./theme";

let osDark = false;
let osListeners = [];

beforeEach(() => {
  osDark = false;
  osListeners = [];
  window.matchMedia = vi.fn(() => ({
    get matches() {
      return osDark;
    },
    addEventListener: (_, fn) => osListeners.push(fn),
    removeEventListener: (_, fn) => (osListeners = osListeners.filter((l) => l !== fn)),
  }));
  localStorage.clear();
  document.documentElement.className = "";
  document.head.innerHTML = '<meta name="theme-color" content="#FFFFFF" />';
});

afterEach(() => {
  delete window.matchMedia;
});

describe("theme preference", () => {
  it("defaults to system and follows the OS", () => {
    expect(getThemePreference()).toBe("system");
    expect(resolveTheme()).toBe("light");
    osDark = true;
    expect(resolveTheme()).toBe("dark");
  });

  it("ignores junk in storage", () => {
    localStorage.setItem(THEME_KEY, "purple");
    expect(getThemePreference()).toBe("system");
  });

  it("pins light or dark regardless of the OS", () => {
    osDark = true;
    expect(resolveTheme("light")).toBe("light");
    osDark = false;
    expect(resolveTheme("dark")).toBe("dark");
  });
});

describe("applying the theme", () => {
  it("toggles the dark class, color-scheme and theme-color", () => {
    applyTheme("dark");
    const root = document.documentElement;
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]').content).toBe("#0A0A0B");

    applyTheme("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(document.querySelector('meta[name="theme-color"]').content).toBe("#FFFFFF");
  });

  it("persists a pinned choice and clears it for system", () => {
    setThemePreference("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    setThemePreference("system");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("ignores unknown values", () => {
    setThemePreference("sepia");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("subscribeTheme", () => {
  it("notifies on preference change and on OS change while on system", () => {
    const cb = vi.fn();
    const off = subscribeTheme(cb);

    setThemePreference("light");
    expect(cb).toHaveBeenCalledTimes(1);

    // Pinned to light: an OS flip is ignored.
    osDark = true;
    osListeners.forEach((l) => l());
    expect(cb).toHaveBeenCalledTimes(1);

    setThemePreference("system");
    expect(cb).toHaveBeenCalledTimes(2);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    osDark = false;
    osListeners.forEach((l) => l());
    expect(cb).toHaveBeenCalledTimes(3);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    off();
    setThemePreference("dark");
    expect(cb).toHaveBeenCalledTimes(3);
  });
});
