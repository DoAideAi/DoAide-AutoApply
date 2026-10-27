"""Direct Apply — apply to a job on any company's own site.

The feed and the boards cover the jobs we find. This covers the job the
candidate found: they paste the posting's URL, and we

1. fetch and parse the page (title, company, requirements) — the same parser
   Smart Apply uses, with Gemini asked first;
2. find where the application actually happens and which ATS runs it
   (:mod:`app.services.apply_links`), or an address to email instead;
3. score the fit and write a grounded cover letter (Gemini first);
4. hand back everything a form will ask for, ready to copy.

The candidate then opens the form themselves and submits it. That is the point,
not a limitation: every ATS on the list is a different form, most sit behind a
candidate account, and the candidate is the one who can see the page. When they
are done they say so, and the job is tracked as applied.

**Storage is the job feed's.** An imported job is a :class:`JobPosting` with
``source="direct"`` — so it dedupes against the feed, carries the fit score and
the ``APPLIED`` status the rest of the product already reads, and its cover
letter is an ordinary :class:`CoverLetter` row keyed on the posting. The apply
link rides in ``source_urls`` as ``{"source": "apply", "url": ...}`` (and an
email as ``apply-email`` / ``mailto:``) rather than in a new column; the
vendor is re-derived from the URL on every read, so nothing about it can go
stale, and :func:`app.services.job_dedup.merge_source_urls` keeps both keys a
merge cares about.

**Gemini first.** :func:`gemini_first` speaks ``chat_completion``'s dialect so
the parser and the letter writer can take it in place of the provider chain.
It sends the resume and the posting — never mail — and falls back to the
chain when Gemini is unavailable, so a missing key degrades to the existing
behaviour rather than to the deterministic fallbacks.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.cover_letter import CoverLetter
from app.models.fit_score import FitScore
from app.models.form_apply import FormApplyProfile
from app.models.job import JobPosting, JobStatus, job_fingerprint
from app.models.resume import Resume
from app.models.user import User
from app.services import apply_links, cover_letter_service, gemini_client
from app.services import smart_apply_service as smart_apply
from app.services.apply_links import ApplyTarget, Vendor
from app.services.fit_scorer import FitResult
from app.services.jd_parser import (
    FetchedPage,
    JobFetchError,
    ParsedJob,
    fetch_job_page,
    parse_heuristic,
    parse_job,
)
from app.services.openrouter_client import chat_completion

logger = logging.getLogger(__name__)

SOURCE = "direct"
APPLY_SOURCE = "apply"
APPLY_EMAIL_SOURCE = "apply-email"
MAX_DESCRIPTION = 20000
MAX_LISTED = 100


class DirectApplyError(RuntimeError):
    """A request Direct Apply cannot satisfy as asked. The message is shown."""


class NoResumeError(DirectApplyError):
    """The candidate has nothing to score or write a letter from yet."""


def gemini_first(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 800,
    timeout: float = 60.0,
) -> str:
    """``chat_completion``, with Gemini tried before the provider chain.

    Raises ``OpenRouterError`` when both fail, so every caller's existing
    fallback fires unchanged.
    """
    system = "\n\n".join(m["content"] for m in messages if m.get("role") == "system")
    prompt = "\n\n".join(m["content"] for m in messages if m.get("role") != "system")
    try:
        return gemini_client.generate(
            system,
            prompt,
            temperature=temperature,
            # The 3.x flash models think before they answer, out of the same
            # budget; a letter-sized cap would truncate the letter.
            max_output_tokens=max(max_tokens, 4096),
            # Per model, and there are three: a stalled one should hand over
            # while the candidate is still watching the spinner.
            timeout=min(timeout, 20.0),
            thinking_level="low",
        )
    except gemini_client.GeminiUnavailable as exc:
        logger.info("direct apply: gemini unavailable (%s), using the provider chain", exc)
    return chat_completion(
        messages, model=model, temperature=temperature, max_tokens=max_tokens, timeout=timeout
    )


# --------------------------------------------------------------------------- #
# The apply link, stored in source_urls                                        #
# --------------------------------------------------------------------------- #


@dataclass
class ApplyInfo:
    url: str | None
    email: str | None
    vendor: Vendor | None


def apply_info(posting: JobPosting) -> ApplyInfo:
    """Where to apply for *posting*, as Direct Apply recorded it."""
    url = email = None
    for entry in posting.source_urls or []:
        source = (entry or {}).get("source")
        if source == APPLY_SOURCE and not url:
            url = entry.get("url")
        elif source == APPLY_EMAIL_SOURCE and not email:
            email = (entry.get("url") or "").removeprefix("mailto:") or None
    vendor = apply_links.detect_vendor(url) or apply_links.detect_vendor(posting.url)
    return ApplyInfo(url=url, email=email, vendor=vendor)


def _with_apply_links(existing: list | None, target: ApplyTarget) -> list[dict[str, str]]:
    kept = [
        dict(entry)
        for entry in existing or []
        if (entry or {}).get("source") not in (APPLY_SOURCE, APPLY_EMAIL_SOURCE)
    ]
    if target.apply_url:
        kept.append({"source": APPLY_SOURCE, "url": target.apply_url})
    if target.apply_email:
        kept.append({"source": APPLY_EMAIL_SOURCE, "url": f"mailto:{target.apply_email}"})
    return kept


# --------------------------------------------------------------------------- #
# Import                                                                       #
# --------------------------------------------------------------------------- #


def _check_url(url: str) -> str:
    url = (url or "").strip()
    parsed = urlparse(url if "://" in url else f"https://{url}")
    if parsed.scheme not in ("http", "https") or "." not in (parsed.hostname or ""):
        raise DirectApplyError("That doesn't look like a job URL — paste the full link.")
    return parsed.geturl()


def _company_from_host(url: str) -> str | None:
    """``careers.acme-labs.com`` → ``Acme Labs``: the last resort for a name."""
    host = (urlparse(url).hostname or "").lower()
    labels = [
        label
        for label in host.split(".")
        if label not in ("www", "careers", "jobs", "career", "apply", "boards", "job")
    ]
    if len(labels) < 2:
        return None
    return labels[-2].replace("-", " ").title()


@dataclass
class ImportResult:
    posting: JobPosting
    job: ParsedJob
    resume: Resume
    fit: FitScore
    fit_result: FitResult
    letter: CoverLetter
    target: ApplyTarget
    created: bool


def import_job(
    db: Session,
    user: User,
    url: str,
    *,
    description: str | None = None,
    resume_id: int | None = None,
) -> ImportResult:
    """Import one posting from its URL and prepare everything to apply.

    *description* is the candidate's own paste, for pages that render the
    posting in JavaScript: it replaces the fetched text, and a failed fetch is
    then only a missing apply link rather than an error.

    Not one transaction: :func:`smart_apply.score_and_save` commits (it
    resolves a race with the nightly scan that way), and company research
    commits its cache — so the posting and its fit score are stored before the
    letter is written. The caller commits the rest; a rollback after a failure
    leaves the posting without a letter, which the detail view handles.
    """
    url = _check_url(url)
    # Checked before anything is fetched or written: with no resume there is no
    # score and no letter, and half an import is worse than none.
    try:
        if smart_apply.resolve_resume(db, user, resume_id) is None:
            raise NoResumeError("Upload a resume before using Direct Apply.")
    except smart_apply.SmartApplyError as exc:
        raise DirectApplyError(str(exc)) from exc

    page: FetchedPage | None = None
    try:
        page = fetch_job_page(url)
    except JobFetchError as exc:
        if not (description or "").strip():
            raise DirectApplyError(str(exc)) from exc
        logger.info("direct apply: fetch failed, using the pasted description: %s", exc)

    text = (description or "").strip() or (page.text if page else "")
    job = parse_job(text, page_title=page.title if page else None, complete=gemini_first)

    page_url = page.final_url if page else url
    target = (
        apply_links.extract_apply_target(page.html, page_url)
        if page
        else apply_links.extract_apply_target("", url)
    )

    job.title = job.title or (page.title if page else None)
    job.company = job.company or _company_from_host(page_url)

    fingerprint = job_fingerprint(job.title, job.company, page_url)
    posting = db.scalar(
        select(JobPosting).where(
            JobPosting.user_id == user.id, JobPosting.fingerprint == fingerprint
        )
    )
    created = posting is None
    if created:
        posting = JobPosting(
            user_id=user.id,
            fingerprint=fingerprint,
            source=SOURCE,
            status=JobStatus.SAVED,
        )
        db.add(posting)
    elif posting.status in (JobStatus.NEW, JobStatus.DISMISSED):
        # Pasting a job is saying you want it, whatever the feed thought.
        posting.status = JobStatus.SAVED
        posting.screened_out_at = None

    posting.title = job.title or posting.title
    posting.company = job.company or posting.company
    posting.location = job.location or posting.location
    if job.remote is not None:
        posting.remote = job.remote
    posting.url = posting.url or page_url
    posting.description = text[:MAX_DESCRIPTION]
    if job.salary_text:
        posting.salary_text = job.salary_text
        posting.salary_min = job.salary_min
        posting.salary_max = job.salary_max
    posting.source_urls = _with_apply_links(posting.source_urls, target)
    db.flush()

    intent = smart_apply.scoring_intent(db, user, job, posting)
    resume = (
        smart_apply.resolve_resume(db, user, resume_id)
        if resume_id is not None
        else intent.resume or smart_apply.resolve_resume(db, user, None)
    )
    fit, fit_result = smart_apply.score_and_save(
        db,
        user,
        resume,
        job,
        posting,
        targeting=intent.targeting,
        profile_id=intent.profile_id,
    )
    letter = cover_letter_service.upsert_letter(
        db,
        user_id=user.id,
        resume=resume,
        job=job,
        job_posting_id=posting.id,
        profile=cover_letter_service.profile_for_posting(db, posting),
        complete=gemini_first,
    )
    return ImportResult(
        posting=posting,
        job=job,
        resume=resume,
        fit=fit,
        fit_result=fit_result,
        letter=letter,
        target=target,
        created=created,
    )


def rewrite_letter(
    db: Session, user: User, posting: JobPosting, *, force: bool = False
) -> CoverLetter:
    """Write the posting's letter again, with Gemini first.

    Leaves a hand-edited letter alone unless *force* — the user's own words are
    never discarded by a button they did not mean as "throw my edits away".
    """
    job = parsed_job(posting)
    intent = smart_apply.scoring_intent(db, user, job, posting)
    resume = intent.resume or smart_apply.resolve_resume(db, user, None)
    if resume is None:
        raise NoResumeError("Upload a resume before using Direct Apply.")
    return cover_letter_service.upsert_letter(
        db,
        user_id=user.id,
        resume=resume,
        job=job,
        job_posting_id=posting.id,
        profile=cover_letter_service.profile_for_posting(db, posting),
        force=force,
        complete=gemini_first,
    )


# --------------------------------------------------------------------------- #
# Reading back                                                                 #
# --------------------------------------------------------------------------- #


def get_owned(db: Session, user: User, posting_id: int) -> JobPosting:
    posting = db.get(JobPosting, posting_id)
    if posting is None or posting.user_id != user.id:
        raise DirectApplyError("Job not found")
    return posting


def list_direct(db: Session, user: User) -> list[JobPosting]:
    """The candidate's imported jobs, most recently touched first."""
    return list(
        db.scalars(
            select(JobPosting)
            .where(JobPosting.user_id == user.id, JobPosting.source == SOURCE)
            .order_by(JobPosting.updated_at.desc(), JobPosting.id.desc())
            .limit(MAX_LISTED)
        )
    )


def parsed_job(posting: JobPosting) -> ParsedJob:
    """The posting's requirements, re-read from its stored text (no LLM)."""
    job = parse_heuristic(posting.description or "", posting.title)
    job.title = posting.title or job.title
    job.company = posting.company or job.company
    job.location = posting.location or job.location
    return job


def latest_fit(db: Session, posting: JobPosting) -> FitScore | None:
    return db.scalar(
        select(FitScore)
        .where(FitScore.job_posting_id == posting.id, FitScore.user_id == posting.user_id)
        .order_by(FitScore.updated_at.desc(), FitScore.id.desc())
        .limit(1)
    )


def latest_resume(db: Session, user: User, posting: JobPosting) -> Resume | None:
    letter = cover_letter_service.get_letter(db, user.id, posting.id)
    if letter is not None and letter.resume_id is not None:
        resume = db.get(Resume, letter.resume_id)
        if resume is not None and resume.user_id == user.id:
            return resume
    return smart_apply.resolve_resume(db, user, None)


def set_applied(posting: JobPosting, applied: bool) -> JobPosting:
    """Record (or take back) that the candidate submitted the form."""
    if applied:
        posting.status = JobStatus.APPLIED
        posting.applied_at = posting.applied_at or datetime.now(UTC)
    elif posting.status is JobStatus.APPLIED:
        posting.status = JobStatus.SAVED
        posting.applied_at = None
    return posting


# --------------------------------------------------------------------------- #
# What the form will ask                                                       #
# --------------------------------------------------------------------------- #


def _yes_no(value: bool | None) -> str | None:
    return None if value is None else ("Yes" if value else "No")


def _link(resume: Resume | None, needle: str) -> str | None:
    for link in (resume.links or []) if resume else []:
        if isinstance(link, str) and needle in link.lower():
            return link
    return None


def form_data(db: Session, user: User, resume: Resume | None) -> dict:
    """Everything an application form commonly asks, from what we already know.

    The candidate's own answers (``form_apply_profiles``) win over what the
    resume parser read, because they are the candidate's words. Legally
    significant answers — work authorization, sponsorship — come only from
    there: a resume does not say, and we never guess.
    """
    profile = db.scalar(select(FormApplyProfile).where(FormApplyProfile.user_id == user.id))
    p = profile

    location = None
    if p and (p.address_city or p.address_country):
        location = ", ".join(x for x in (p.address_city, p.address_country) if x)
    location = location or (resume.location if resume else None)

    data = {
        "full_name": (resume.full_name if resume else None) or user.full_name,
        "email": (resume.email if resume else None) or user.email,
        "phone": (p.phone if p else None) or (resume.phone if resume else None),
        "location": location,
        "linkedin_url": (p.linkedin_url if p else None) or _link(resume, "linkedin.com"),
        "github_url": (p.github_url if p else None) or _link(resume, "github.com"),
        "website_url": p.website_url if p else None,
        "resume_id": resume.id if resume else None,
        "resume_filename": resume.filename if resume else None,
        "headline": resume.headline if resume else None,
        "years_experience": resume.years_experience if resume else None,
    }

    answers: list[dict[str, str]] = []
    if p:
        notice = f"{p.notice_period_days} days" if p.notice_period_days is not None else None
        for label, value in (
            ("Authorized to work", _yes_no(p.work_authorized)),
            ("Requires visa sponsorship", _yes_no(p.requires_sponsorship)),
            ("Willing to relocate", _yes_no(p.willing_to_relocate)),
            ("Notice period", notice),
            ("Earliest start date", p.earliest_start),
            ("Expected salary", p.desired_salary),
        ):
            if value:
                answers.append({"label": label, "value": value})
        for question, answer in (p.custom_answers or {}).items():
            if question and answer:
                answers.append({"label": str(question), "value": str(answer)})
    data["answers"] = answers

    # Asked by nearly every form, and the candidate's to supply.
    data["missing"] = [
        label
        for label, value in (
            ("Phone", data["phone"]),
            ("LinkedIn URL", data["linkedin_url"]),
            ("Notice period", p and p.notice_period_days is not None),
            ("Expected salary", p and p.desired_salary),
        )
        if not value
    ]
    return data


__all__ = [
    "APPLY_EMAIL_SOURCE",
    "APPLY_SOURCE",
    "SOURCE",
    "ApplyInfo",
    "DirectApplyError",
    "ImportResult",
    "NoResumeError",
    "apply_info",
    "form_data",
    "gemini_first",
    "get_owned",
    "import_job",
    "latest_fit",
    "latest_resume",
    "list_direct",
    "parsed_job",
    "rewrite_letter",
    "set_applied",
]
