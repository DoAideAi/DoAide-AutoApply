import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import GmailAIConsent from "./GmailAIConsent";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({ api: {
  gmailAIConsent: vi.fn(), setGmailAIConsent: vi.fn(),
} }));

beforeEach(() => {
  vi.clearAllMocks();
  api.gmailAIConsent.mockResolvedValue({ enabled: false, version: "2026-10-13" });
});

it("never grants consent on load and records an explicit choice", async () => {
  api.setGmailAIConsent.mockResolvedValue({ enabled: true, version: "2026-10-13" });
  render(<GmailAIConsent />);
  const checkbox = screen.getByRole("checkbox");
  await waitFor(() => expect(checkbox).not.toBeDisabled());
  expect(checkbox).not.toBeChecked();
  expect(api.setGmailAIConsent).not.toHaveBeenCalled();
  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox).toBeChecked());
  expect(api.setGmailAIConsent).toHaveBeenCalledWith(true, "2026-10-13");
});

it("keeps the recorded state when a save fails", async () => {
  api.setGmailAIConsent.mockRejectedValue(new Error("Save failed"));
  render(<GmailAIConsent />);
  const checkbox = screen.getByRole("checkbox");
  await waitFor(() => expect(checkbox).not.toBeDisabled());
  fireEvent.click(checkbox);
  expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
  expect(checkbox).not.toBeChecked();
});
