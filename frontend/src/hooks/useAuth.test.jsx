import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast";

vi.mock("../lib/api", () => ({
  SESSION_EXPIRED_EVENT: "autoapply:session-expired",
  getToken: vi.fn(() => "token"),
  setToken: vi.fn(),
  api: { me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() },
}));

import { api } from "../lib/api";
import { AuthProvider, useAuth } from "./useAuth";

function Who() {
  const { user, loading } = useAuth();
  if (loading) return <p>loading</p>;
  return <p>{user ? `signed in as ${user.email}` : "signed out"}</p>;
}

function renderAuth() {
  return render(
    <ToastProvider>
      <AuthProvider>
        <Who />
      </AuthProvider>
    </ToastProvider>
  );
}

describe("AuthProvider session expiry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signs the user out and says why when the session expires", async () => {
    api.me.mockResolvedValue({ email: "a@b.co" });
    renderAuth();
    expect(await screen.findByText("signed in as a@b.co")).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event("autoapply:session-expired")));

    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  });

  it("stays quiet when nobody was signed in", async () => {
    api.me.mockRejectedValue(new Error("Not authenticated"));
    renderAuth();
    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());

    act(() => window.dispatchEvent(new Event("autoapply:session-expired")));

    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument();
  });
});
