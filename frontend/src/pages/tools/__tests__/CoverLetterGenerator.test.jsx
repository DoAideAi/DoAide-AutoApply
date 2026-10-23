import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("../../../lib/api", () => ({ api: { toolCoverLetter: vi.fn() } }));

import { api } from "../../../lib/api";
import CoverLetterGenerator from "../CoverLetterGenerator";

function renderPage() {
  return render(<MemoryRouter><CoverLetterGenerator /></MemoryRouter>);
}

function fillRequired({ company = "TestCo", title = "Engineer", skills = "React, Node" } = {}) {
  fireEvent.change(screen.getByLabelText("Company Name"), { target: { value: company } });
  fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Key Skills (comma-separated)"), { target: { value: skills } });
}

describe("CoverLetterGenerator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders heading and labelled form fields", () => {
    renderPage();
    expect(screen.getByText("Cover Letter Generator")).toBeInTheDocument();
    expect(screen.getByLabelText("Your Name")).toHaveAttribute("placeholder", "Jane Smith");
    expect(screen.getByLabelText("Job posting (optional)")).toBeInTheDocument();
  });

  it("shows the AI-written letter and sends the form as the API expects", async () => {
    api.toolCoverLetter.mockResolvedValue({ letter: "Dear Hiring Manager,\n\nAI letter for TestCo" });
    renderPage();
    fireEvent.change(screen.getByLabelText("Your Name"), { target: { value: "Jane" } });
    fillRequired();
    fireEvent.change(screen.getByLabelText("Job posting (optional)"), { target: { value: "Build APIs" } });
    fireEvent.click(screen.getByText("Generate Cover Letter"));

    expect(await screen.findByText(/AI letter for TestCo/)).toBeInTheDocument();
    expect(screen.getByText(/Written by AI/)).toBeInTheDocument();
    expect(api.toolCoverLetter).toHaveBeenCalledWith({
      name: "Jane",
      company: "TestCo",
      job_title: "Engineer",
      skills: "React, Node",
      interest: "",
      job_description: "Build APIs",
    });
  });

  it("falls back to the template when the AI is unavailable", async () => {
    api.toolCoverLetter.mockRejectedValue(new Error("AI writing is not available"));
    renderPage();
    fillRequired({ company: "FooCorp" });
    fireEvent.click(screen.getByText("Generate Cover Letter"));

    expect(await screen.findByText(/from our template/)).toBeInTheDocument();
    expect(screen.getByText(/Dear Hiring Manager/)).toBeInTheDocument();
    expect(screen.getByText(/position at FooCorp/)).toBeInTheDocument();
  });

  it("disables the button while the letter is being written", async () => {
    let finish;
    api.toolCoverLetter.mockReturnValue(new Promise((r) => (finish = r)));
    renderPage();
    fillRequired();
    fireEvent.click(screen.getByText("Generate Cover Letter"));

    expect(screen.getByRole("button", { name: "Writing your letter…" })).toBeDisabled();
    finish({ letter: "done" });
    expect(await screen.findByText("done")).toBeInTheDocument();
  });
});
