import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Logo from "./Logo";

describe("Logo", () => {
  it("draws the robot with white eyes so they read against the face", () => {
    const { container } = render(<Logo />);
    const eyes = container.querySelectorAll('[data-part="eye"]');
    expect(eyes).toHaveLength(2);
    for (const eye of eyes) expect(eye.getAttribute("fill")).toBe("#FFFFFF");
  });

  it("takes the face colour from currentColor so the theme drives it", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("rect").getAttribute("fill")).toBe("currentColor");
  });

  it("is decorative without a title and labelled with one", () => {
    const { container, rerender } = render(<Logo />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    rerender(<Logo title="DoAide AutoApply" />);
    expect(screen.getByRole("img", { name: "DoAide AutoApply" })).toBeInTheDocument();
  });
});
