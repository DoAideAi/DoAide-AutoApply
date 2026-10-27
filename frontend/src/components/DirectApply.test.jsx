import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DirectApply from "./DirectApply";
import { ToastProvider } from "./ui/Toast";

vi.mock("../lib/api", () => ({
  api: {
    listDirectJobs: vi.fn(),
    importDirectJob: vi.fn(),
    getDirectJob: vi.fn(),
    rewriteDirectLetter: vi.fn(),
    markDirectApplied: vi.fn(),
    unmarkDirectApplied: vi.fn(),
  },
}));

import { api } from "../lib/api";

const OORWIN =
  "https://tachyonind.oorwin.ai/#/careers/index.html/job/d341d25fa1807ef0cea6a335b8b2c9948d6d1ddf";

const JOB = {
  id: 7,
  title: "AI Architect",
  company: "Tachyon Technologies",
  location: "Hyderabad, TS",
  url: "https://www.tachyontech.com/jobs/ai-architect-2/",
  apply_url: OORWIN,
  apply_email: null,
  ats_key: "oorwin",
  ats_label: "Oorwin",
  ats_kind: "ats",
  status: "SAVED",
  applied_at: null,
  fit_score: 82,
  created_at: "2026-10-27T10:00:00Z",
  updated_at: "2026-10-27T10:00:00Z",
};

const KIT = {
  job: JOB,
  description: "We are hiring an AI Architect…",
  requirements: { required_skills: ["python", "llms"], preferred_skills: [], responsibilities: [] },
  fit: {
    overall: 82,
    recommendation: "strong",
    summary: "Strong match on Python and LLM systems.",
    matched_skills: ["python"],
    missing_skills: ["kubernetes"],
  },
  cover_letter: {
    id: 3,
    resume_id: 1,
    body: "I have built RAG pipelines…",
    full_text: "Dear Hiring Team,\n\nI have built RAG pipelines…\n\nJordan",
    edited: false,
    created_at: "2026-10-27T10:00:00Z",
  },
  form: {
    full_name: "Jordan Candidate",
    email: "jordan@example.com",
    phone: "+91 98765 43210",
    resume_filename: "jordan.pdf",
    answers: [{ label: "Notice period", value: "30 days" }],
    missing: ["LinkedIn URL"],
  },
  created: true,
};

function renderPanel() {
  const onError = vi.fn();
  render(
    <ToastProvider>
      <DirectApply onError={onError} />
    </ToastProvider>,
  );
  return onError;
}

async function importJob(user) {
  await user.type(screen.getByLabelText("Job URL"), JOB.url);
  await user.click(screen.getByRole("button", { name: "Import job" }));
  return screen.findByRole("article", { name: "Prepared application" });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listDirectJobs.mockResolvedValue([]);
  api.importDirectJob.mockResolvedValue(KIT);
  api.getDirectJob.mockResolvedValue(KIT);
  api.markDirectApplied.mockResolvedValue({
    ...JOB,
    status: "APPLIED",
    applied_at: "2026-10-27T11:00:00Z",
  });
  api.unmarkDirectApplied.mockResolvedValue(JOB);
  api.rewriteDirectLetter.mockResolvedValue({ ...KIT.cover_letter, full_text: "A new letter" });
});

describe("DirectApply", () => {
  it("imports a pasted URL and shows the prepared application", async () => {
    const user = userEvent.setup();
    renderPanel();
    const kit = await importJob(user);

    expect(api.importDirectJob).toHaveBeenCalledWith({ url: JOB.url, description: undefined });
    expect(within(kit).getByText("AI Architect")).toBeInTheDocument();
    expect(within(kit).getByText("Oorwin ATS")).toBeInTheDocument();
    expect(within(kit).getByText("Strong match on Python and LLM systems.")).toBeInTheDocument();
    expect(within(kit).getByText(/I have built RAG pipelines/)).toBeInTheDocument();
  });

  it("Apply now opens the ATS form in a new tab", async () => {
    const user = userEvent.setup();
    renderPanel();
    const kit = await importJob(user);

    const apply = within(kit).getByRole("link", { name: "Apply now" });
    expect(apply).toHaveAttribute("href", OORWIN);
    expect(apply).toHaveAttribute("target", "_blank");
    expect(apply).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("copies the cover letter", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPanel();
    const kit = await importJob(user);

    await user.click(within(kit).getByRole("button", { name: "Copy cover letter" }));
    expect(writeText).toHaveBeenCalledWith(KIT.cover_letter.full_text);
  });

  it("lists the form answers, each copyable, and what is still missing", async () => {
    const user = userEvent.setup();
    renderPanel();
    const kit = await importJob(user);

    expect(within(kit).getByText("jordan@example.com")).toBeInTheDocument();
    expect(within(kit).getByText("30 days")).toBeInTheDocument();
    expect(within(kit).getByText("jordan.pdf")).toBeInTheDocument();
    expect(within(kit).getAllByRole("button", { name: "Copy" }).length).toBeGreaterThan(3);
    expect(within(kit).getByText(/LinkedIn URL/)).toBeInTheDocument();
  });

  it("marks the job applied after opening the form", async () => {
    const user = userEvent.setup();
    renderPanel();
    const kit = await importJob(user);

    const apply = within(kit).getByRole("link", { name: "Apply now" });
    apply.addEventListener("click", (e) => e.preventDefault());
    await user.click(apply);
    expect(within(kit).getByText(/Submitted it\?/)).toBeInTheDocument();

    await user.click(within(kit).getByRole("button", { name: "Mark as applied" }));
    await waitFor(() => expect(api.markDirectApplied).toHaveBeenCalledWith(7));
    expect(await within(kit).findByText(/^applied/)).toBeInTheDocument();
    // On mount, after the import, and after marking it applied.
    expect(api.listDirectJobs).toHaveBeenCalledTimes(3);
  });

  it("asks for the description when the page cannot be read", async () => {
    const user = userEvent.setup();
    api.importDirectJob.mockRejectedValueOnce(
      new Error("That page didn't return readable job text — paste the description instead."),
    );
    const onError = renderPanel();

    await user.type(screen.getByLabelText("Job URL"), OORWIN);
    await user.click(screen.getByRole("button", { name: "Import job" }));

    const box = await screen.findByLabelText("Job description");
    expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/readable job text/));

    await user.type(box, "AI Architect at Tachyon");
    await user.click(screen.getByRole("button", { name: "Import job" }));
    await waitFor(() =>
      expect(api.importDirectJob).toHaveBeenLastCalledWith({
        url: OORWIN,
        description: "AI Architect at Tachyon",
      }),
    );
  });

  it("offers apply-by-email through Gmail with the letter as the body", async () => {
    const user = userEvent.setup();
    api.importDirectJob.mockResolvedValue({
      ...KIT,
      job: { ...JOB, apply_url: null, apply_email: "careers@tachyon.com" },
    });
    renderPanel();
    const kit = await importJob(user);

    const link = within(kit).getByRole("link", { name: "Apply by email" });
    const params = new URL(link.getAttribute("href")).searchParams;
    expect(params.get("to")).toBe("careers@tachyon.com");
    expect(params.get("body")).toBe(KIT.cover_letter.full_text);
  });

  it("shows imported jobs and reopens one", async () => {
    const user = userEvent.setup();
    api.listDirectJobs.mockResolvedValue([
      { ...JOB, status: "APPLIED", applied_at: "2026-10-27T11:00:00Z" },
    ]);
    renderPanel();

    const list = await screen.findByRole("list", { name: "Imported jobs" });
    expect(within(list).getByText(/^applied/)).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: /AI Architect/ }));

    expect(api.getDirectJob).toHaveBeenCalledWith(7);
    expect(await screen.findByRole("article", { name: "Prepared application" })).toBeInTheDocument();
  });
});
