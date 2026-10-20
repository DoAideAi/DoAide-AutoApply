import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY } from "../lib/theme";
import ThemeToggle from "./ThemeToggle";

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  localStorage.clear();
  document.documentElement.className = "";
});

afterEach(() => {
  delete window.matchMedia;
});

describe("ThemeToggle", () => {
  it("offers System, Light and Dark as a radiogroup with System selected by default", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual([
      "System theme",
      "Light theme",
      "Dark theme",
    ]);
    expect(screen.getByRole("radio", { name: "System theme" })).toHaveAttribute("aria-checked", "true");
  });

  it("switches to dark, persists it and marks it checked", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("radio", { name: "Dark theme" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark theme" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "System theme" })).toHaveAttribute("aria-checked", "false");
  });

  it("keeps every toggle on the page in step", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ThemeToggle />
        <ThemeToggle variant="onDark" />
      </>,
    );
    const [first] = screen.getAllByRole("radio", { name: "Light theme" });
    await user.click(first);
    for (const radio of screen.getAllByRole("radio", { name: "Light theme" })) {
      expect(radio).toHaveAttribute("aria-checked", "true");
    }
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("returning to System clears the stored choice", async () => {
    localStorage.setItem(THEME_KEY, "dark");
    const user = userEvent.setup();
    render(<ThemeToggle />);
    expect(screen.getByRole("radio", { name: "Dark theme" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "System theme" }));
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
});
