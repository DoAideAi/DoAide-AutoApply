import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Landing from "./Landing";
import { api } from "../lib/api";

const auth = { user: null, loading: false, login: vi.fn(), register: vi.fn() };
vi.mock("../hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("../lib/api", () => ({ api: { ssoProviders: vi.fn() } }));

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.ssoProviders.mockResolvedValue({ providers: ["google", "github", "microsoft"] });
  auth.user = null;
  auth.loading = false;
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

describe("Landing", () => {
  it("is dark whatever the app theme, like Pulse", () => {
    renderLanding();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByTestId("landing")).toHaveClass("dark");
  });

  it("shows the mascot, tagline, workflow, stats and features", () => {
    renderLanding();
    expect(screen.getByRole("img", { name: "DoAide mascot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "AI-powered job application platform",
    );

    const flow = screen.getByRole("list", { name: "How AutoApply works" });
    expect(within(flow).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Upload",
      "Match",
      "Tailor",
      "Reach out",
      "Interview",
    ]);

    expect(screen.getByText("steps from resume to interview")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Smart Job Matching" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ghost-Job Filter" })).toBeInTheDocument();
  });

  it("links the DoAide products and keeps the theme switch", () => {
    renderLanding();
    const products = screen.getByRole("navigation", { name: "DoAide products" });
    expect(within(products).getByRole("link", { name: "Pulse" })).toHaveAttribute(
      "href",
      "https://pulse.doaide.com",
    );
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  });

  it("signs in with email and password", async () => {
    const user = userEvent.setup();
    auth.login.mockResolvedValue();
    renderLanding();

    await user.type(screen.getByLabelText("Email"), "me@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(auth.login).toHaveBeenCalledWith("me@example.com", "hunter2hunter2");
  });

  it("creates an account from the second tab, name optional", async () => {
    const user = userEvent.setup();
    auth.register.mockResolvedValue();
    renderLanding();

    await user.click(screen.getByRole("tab", { name: "Create account" }));
    expect(screen.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");

    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "longenough1");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(auth.register).toHaveBeenCalledWith("new@example.com", "longenough1", null);
  });

  it("shows the error when sign-in fails", async () => {
    const user = userEvent.setup();
    auth.login.mockRejectedValue(new Error("Incorrect email or password"));
    renderLanding();

    await user.type(screen.getByLabelText("Email"), "me@example.com");
    await user.type(screen.getByLabelText("Password"), "wrongpassword");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
  });

  it("offers every configured SSO provider", async () => {
    renderLanding();
    expect(await screen.findByRole("link", { name: "Google" })).toHaveAttribute("href", "/api/v1/auth/sso/google");
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "/api/v1/auth/sso/github");
    expect(screen.getByRole("link", { name: "Microsoft" })).toHaveAttribute("href", "/api/v1/auth/sso/microsoft");
  });

  it("hides SSO providers the server has not configured", async () => {
    api.ssoProviders.mockResolvedValue({ providers: ["google"] });
    renderLanding();
    expect(await screen.findByRole("link", { name: "Google" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "GitHub" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Microsoft" })).not.toBeInTheDocument();
  });

  it("shows no SSO section when no provider is configured", async () => {
    api.ssoProviders.mockResolvedValue({ providers: [] });
    renderLanding();
    await Promise.resolve();
    expect(screen.queryByText("or continue with")).not.toBeInTheDocument();
  });

  it("explains an SSO failure the callback sent back", () => {
    window.history.replaceState(null, "", "/?error=google_auth_failed");
    renderLanding();
    expect(screen.getByRole("alert")).toHaveTextContent("Google sign-in didn't complete");
    expect(window.location.search).toBe("");
  });
});
