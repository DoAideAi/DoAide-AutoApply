import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

import App from "./App";

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe("App routing", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("shows a 404 page for unknown URLs instead of redirecting home", async () => {
    renderAt("/no-such-page");
    expect(await screen.findByRole("heading", { name: "This page doesn't exist" })).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]').content).toBe("noindex");
    expect(screen.getByRole("link", { name: "Free tools" })).toHaveAttribute("href", "/tools");
  });

  it("loads a lazy public page and sets its canonical", async () => {
    renderAt("/tools/resume-score");
    expect(await screen.findByRole("heading", { level: 1, name: "ATS Resume Score Checker" })).toBeInTheDocument();
    expect(document.head.querySelector('link[rel="canonical"]').href).toBe(
      "https://job.doaide.com/tools/resume-score"
    );
    expect(document.title).toBe("Free ATS Resume Score Checker | DoAide AutoApply");
  });

  it("sends signed-out visitors on app routes back to the landing page", async () => {
    renderAt("/pipeline");
    expect(await screen.findByRole("button", { name: /sign in|log in|get started|continue/i })).toBeInTheDocument();
  });
});
