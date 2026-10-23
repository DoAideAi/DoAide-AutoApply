import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../lib/api", () => ({ api: { toolResumeText: vi.fn() } }));

import { api } from "../../../lib/api";
import ResumeScore from "../ResumeScore";

function renderPage() {
  return render(<MemoryRouter><ResumeScore /></MemoryRouter>);
}

describe("ResumeScore", () => {
  it("renders the heading and textarea", () => {
    renderPage();
    expect(screen.getByText("ATS Resume Score Checker")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/paste your resume/i)).toBeInTheDocument();
  });

  it("disables analyze button when textarea is empty", () => {
    renderPage();
    expect(screen.getByText("Analyze Resume")).toBeDisabled();
  });

  it("calculates a score for a sample resume", () => {
    renderPage();
    const textarea = screen.getByPlaceholderText(/paste your resume/i);
    fireEvent.change(textarea, {
      target: {
        value: "Experience: Led a team of 12 engineers. Managed $2M budget. Achieved 30% growth. Education: BS Computer Science. Skills: Python, React, Node.js. Contact: jane@example.com Phone: 555-123-4567",
      },
    });
    fireEvent.click(screen.getByText("Analyze Resume"));
    expect(screen.getByText(/strong|needs work|weak/i)).toBeInTheDocument();
  });

  it("shows improvement tips", () => {
    renderPage();
    const textarea = screen.getByPlaceholderText(/paste your resume/i);
    fireEvent.change(textarea, { target: { value: "short resume" } });
    fireEvent.click(screen.getByText("Analyze Resume"));
    expect(screen.getByText("Tips to Improve")).toBeInTheDocument();
  });

  it("scores an uploaded resume file", async () => {
    api.toolResumeText.mockResolvedValue({
      text: "Experience: Led a team of 12 engineers. Achieved 30% growth. Education: BS. Skills: Python. jane@example.com 555-123-4567",
      words: 20,
      truncated: false,
    });
    renderPage();
    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/upload pdf or docx/i), { target: { files: [file] } });

    expect(await screen.findByText("Tips to Improve")).toBeInTheDocument();
    expect(api.toolResumeText).toHaveBeenCalledWith(file);
    expect(screen.getByLabelText("Resume text").value).toMatch(/Led a team of 12 engineers/);
  });

  it("shows why an upload could not be read", async () => {
    api.toolResumeText.mockRejectedValue(new Error("cv.pdf: no text found — is it a scanned image?"));
    renderPage();
    const file = new File(["x"], "cv.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/upload pdf or docx/i), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("scanned image");
  });
});
