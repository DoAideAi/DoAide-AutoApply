/**
 * Direct Apply — apply to a job on any company's own site.
 *
 * The candidate pastes the posting's URL. The server reads the page, finds where
 * the application form actually lives (often an ATS on another domain — Oorwin,
 * BambooHR, Greenhouse), scores the fit and writes a cover letter. This panel
 * shows all of that and hands it over: "Apply now" opens the form in a new tab,
 * and every answer the form will ask for sits beside it with a copy button.
 *
 * We open the form; the candidate submits it. Every ATS is a different form and
 * most sit behind an account, so whether it went in is the candidate's word —
 * the same "open it, then mark it" contract as Send via Gmail. Marking it
 * applied is what puts the job in the list below as applied.
 */
import { useCallback, useEffect, useState } from "react";

import { FitPill, KeywordSplit } from "./FitScore";
import CopyButton from "./ui/CopyButton";
import { useToast } from "./ui/Toast";
import { api } from "../lib/api";
import { formatWhen } from "../lib/format";
import { gmailComposeUrl } from "../lib/gmail";

const NEEDS_TEXT = /readable job text|javascript|login/i;

export default function DirectApply({ onError }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [askText, setAskText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [kit, setKit] = useState(null);

  const loadJobs = useCallback(async () => {
    try {
      setJobs((await api.listDirectJobs()) || []);
    } catch {
      // The list is a convenience; the import still works without it.
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  async function importJob(event) {
    event.preventDefault();
    if (!url.trim()) return;
    onError?.(null);
    setBusy(true);
    try {
      const result = await api.importDirectJob({
        url: url.trim(),
        description: description.trim() || undefined,
      });
      setKit(result);
      setUrl("");
      setDescription("");
      setAskText(false);
      toast.success(result.created ? "Job imported." : "Job updated.");
      await loadJobs();
    } catch (err) {
      // A page that renders in JavaScript gives us nothing to read; the
      // candidate's own copy of the description is the way through.
      if (NEEDS_TEXT.test(err.message)) setAskText(true);
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function open(id) {
    onError?.(null);
    try {
      setKit(await api.getDirectJob(id));
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function setApplied(job, applied) {
    try {
      const next = applied
        ? await api.markDirectApplied(job.id)
        : await api.unmarkDirectApplied(job.id);
      setKit((k) => (k && k.job.id === next.id ? { ...k, job: next } : k));
      toast.success(applied ? "Marked as applied." : "Marked as not applied.");
      await loadJobs();
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function rewriteLetter(force) {
    try {
      const letter = await api.rewriteDirectLetter(kit.job.id, force);
      setKit((k) => ({ ...k, cover_letter: letter }));
      toast.success("Cover letter rewritten.");
    } catch (err) {
      onError?.(err.message);
    }
  }

  return (
    <section className="panel space-y-5 p-5" aria-labelledby="direct-apply-title">
      <div>
        <p className="eyebrow">Direct Apply</p>
        <h2 id="direct-apply-title" className="mt-2 text-lg font-medium text-white">
          Apply to a job on any company site
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/45">
          Paste the job's URL. We find the application form, score your fit and
          write a cover letter — then you apply with everything ready to copy.
        </p>
      </div>

      <form onSubmit={importJob} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input flex-1"
            type="url"
            inputMode="url"
            aria-label="Job URL"
            placeholder="Paste Job URL — https://company.com/jobs/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <button className="btn-primary" type="submit" disabled={busy || !url.trim()}>
            {busy ? "Reading the job…" : "Import job"}
          </button>
        </div>
        {busy && (
          <p className="text-xs text-white/40" role="status">
            Reading the page, finding the application form and writing your
            cover letter — this can take up to a minute.
          </p>
        )}
        {askText ? (
          <textarea
            className="input min-h-[140px] text-sm"
            aria-label="Job description"
            placeholder="That page needs a browser to read. Paste the job description here and import again."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
        ) : (
          <button
            type="button"
            className="btn-quiet px-0"
            onClick={() => setAskText(true)}
          >
            Page won't load? Paste the description too
          </button>
        )}
      </form>

      {kit && (
        <ApplyKit
          kit={kit}
          onApplied={(applied) => setApplied(kit.job, applied)}
          onRewrite={rewriteLetter}
          onError={onError}
        />
      )}

      <DirectJobList jobs={jobs} activeId={kit?.job.id} onOpen={open} />
    </section>
  );
}

function AtsBadge({ job }) {
  if (!job.ats_label) return null;
  return (
    <span className="badge bg-white/[0.06] text-white/60" title="Where the application form is">
      {job.ats_kind === "board" ? job.ats_label : `${job.ats_label} ATS`}
    </span>
  );
}

function StatusBadge({ job }) {
  return job.status === "APPLIED" ? (
    <span className="badge bg-good/20 text-good">
      applied{job.applied_at ? ` ${formatWhen(job.applied_at)}` : ""}
    </span>
  ) : (
    <span className="badge bg-signal/15 text-signal">ready to apply</span>
  );
}

/** The job, the letter and the form answers — everything needed to apply. */
function ApplyKit({ kit, onApplied, onRewrite, onError }) {
  const { job, fit, cover_letter: letter, form, requirements } = kit;
  const [opened, setOpened] = useState(false);
  const applyUrl = job.apply_url || job.url;
  const letterText = letter?.full_text || "";
  const applied = job.status === "APPLIED";

  return (
    <article className="space-y-5 rounded-xl border p-4 hairline" aria-label="Prepared application">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-white">{job.title || "Untitled role"}</h3>
          <p className="text-sm text-white/55">
            {[job.company, job.location].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge job={job} />
            <AtsBadge job={job} />
            {job.fit_score != null && <FitPill score={job.fit_score} />}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {applyUrl && (
          <a
            className="btn-primary"
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpened(true)}
          >
            Apply now
          </a>
        )}
        {job.apply_email && (
          <a
            className={applyUrl ? "btn-ghost" : "btn-primary"}
            href={gmailComposeUrl({
              to: job.apply_email,
              subject: `Application: ${job.title || "the open role"}`,
              body: letterText,
            })}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpened(true)}
          >
            Apply by email
          </a>
        )}
        {letterText && (
          <CopyButton
            text={letterText}
            label="Copy cover letter"
            copiedLabel="Copied"
            className="btn-ghost"
            onError={onError}
          />
        )}
        {applied ? (
          <button className="btn-quiet" onClick={() => onApplied(false)}>
            Undo applied
          </button>
        ) : (
          <button className={opened ? "btn-primary" : "btn-ghost"} onClick={() => onApplied(true)}>
            Mark as applied
          </button>
        )}
      </div>
      {!job.apply_url && !job.apply_email && (
        <p className="text-xs text-white/40">
          We couldn't find a separate application form on that page, so Apply now
          opens the job page itself.
        </p>
      )}
      {opened && !applied && (
        <p className="text-xs text-white/45">
          Submitted it? Mark it as applied so it's tracked.
        </p>
      )}

      {fit && (
        <div className="space-y-2">
          <p className="eyebrow">Fit</p>
          {fit.summary && <p className="text-sm text-white/60">{fit.summary}</p>}
          <KeywordSplit matched={fit.matched_skills} missing={fit.missing_skills} />
        </div>
      )}

      <FormAnswers form={form} onError={onError} />

      {letter && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow">Cover letter</p>
            <button
              className="btn-quiet"
              onClick={() => onRewrite(letter.edited)}
              title={letter.edited ? "Replaces your edits" : undefined}
            >
              Rewrite
            </button>
          </div>
          <p className="whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 text-sm leading-relaxed text-white/75">
            {letterText}
          </p>
        </div>
      )}

      {requirements?.required_skills?.length > 0 && (
        <div className="space-y-1">
          <p className="eyebrow">They ask for</p>
          <p className="text-sm text-white/55">{requirements.required_skills.join(", ")}</p>
        </div>
      )}
    </article>
  );
}

const FORM_ROWS = [
  ["full_name", "Full name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["location", "Location"],
  ["linkedin_url", "LinkedIn"],
  ["github_url", "GitHub"],
  ["website_url", "Website"],
  ["headline", "Current title"],
  ["years_experience", "Years of experience"],
];

/** What the form will ask, each with its own copy button. */
function FormAnswers({ form, onError }) {
  if (!form) return null;
  const rows = [
    ...FORM_ROWS.filter(([key]) => form[key] != null && form[key] !== "").map(
      ([key, label]) => ({ label, value: String(form[key]) }),
    ),
    ...(form.answers || []),
  ];
  return (
    <div className="space-y-2">
      <p className="eyebrow">Your answers</p>
      <dl className="divide-y rounded-lg border hairline">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 px-3 py-2 hairline">
            <dt className="w-40 shrink-0 text-xs text-white/40">{row.label}</dt>
            <dd className="min-w-0 flex-1 truncate text-sm text-white/80">{row.value}</dd>
            <CopyButton text={row.value} label="Copy" onError={onError} />
          </div>
        ))}
        {form.resume_filename && (
          <div className="flex items-center gap-3 px-3 py-2 hairline">
            <dt className="w-40 shrink-0 text-xs text-white/40">Resume</dt>
            <dd className="min-w-0 flex-1 truncate text-sm text-white/80">
              {form.resume_filename}
            </dd>
            <span className="text-[11px] text-white/35">upload this file</span>
          </div>
        )}
      </dl>
      {form.missing?.length > 0 && (
        <p className="text-xs text-warn">
          Most forms also ask for: {form.missing.join(", ")}. Have them to hand.
        </p>
      )}
    </div>
  );
}

/** Imported jobs, newest first — the Direct Apply part of the tracker. */
function DirectJobList({ jobs, activeId, onOpen }) {
  if (!jobs.length) return null;
  return (
    <div className="space-y-2">
      <p className="eyebrow">Imported jobs</p>
      <ul className="divide-y rounded-lg border hairline" aria-label="Imported jobs">
        {jobs.map((job) => (
          <li key={job.id}>
            <button
              className={[
                "flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03]",
                job.id === activeId ? "bg-white/[0.04]" : "",
              ].join(" ")}
              onClick={() => onOpen(job.id)}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-white/80">
                {job.title || "Untitled role"}
                {job.company && <span className="text-white/40"> · {job.company}</span>}
              </span>
              <AtsBadge job={job} />
              {job.fit_score != null && <FitPill score={job.fit_score} />}
              <StatusBadge job={job} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
