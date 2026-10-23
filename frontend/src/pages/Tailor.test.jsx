import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast";

vi.mock("../lib/api", () => ({
  api: {
    listResumes: vi.fn(),
    listTailored: vi.fn(),
    getJob: vi.fn(),
    tailor: vi.fn(),
  },
}));

import { api } from "../lib/api";
import Tailor from "./Tailor";

function renderAt(path) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Tailor />
      </MemoryRouter>
    </ToastProvider>
  );
}

describe("Tailor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listResumes.mockResolvedValue([]);
    api.listTailored.mockResolvedValue([]);
  });

  it("says so when the job it was opened for can't be loaded", async () => {
    api.getJob.mockRejectedValue(new Error("Job not found"));
    renderAt("/tailor?job=42");
    expect(await screen.findByText(/Couldn't load that job \(Job not found\)/)).toBeInTheDocument();
    expect(api.getJob).toHaveBeenCalledWith(42);
  });

  it("does not fetch a job when opened without one", async () => {
    renderAt("/tailor");
    await screen.findAllByText(/tailor/i);
    expect(api.getJob).not.toHaveBeenCalled();
  });
});
