"""Backends for the free, signed-out tools at /tools.

Nobody is authenticated here, so every route is keyed to the caller's address
by :func:`ip_rate_limit`, stores nothing, and caps what it will read. They are
top-of-funnel pages: the job is to be useful in ten seconds without a signup.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.core.rate_limit import ip_rate_limit
from app.core.uploads import read_capped, safe_upload_filename
from app.routers.resumes import extract_text, suffix_for
from app.services import gemini_client
from app.services.untrusted import fence, guarded

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tools", tags=["tools"])

# Each letter is a paid model call a stranger can trigger; a person writing
# letters for a few applications in one sitting fits comfortably under this.
_cover_letter_limit = ip_rate_limit(8, 600, scope="tools:cover-letter")
_resume_text_limit = ip_rate_limit(10, 600, scope="tools:resume-text")

#: Smaller than the signed-in upload's 10 MB: a resume is a page or two, and
#: this route reads a stranger's file for nothing in return.
_MAX_RESUME_BYTES = 5 * 1024 * 1024
#: What goes back to the page. Anything longer is not a resume.
_MAX_RESUME_CHARS = 20_000


class CoverLetterIn(BaseModel):
    name: str = Field("", max_length=100)
    company: str = Field(..., min_length=1, max_length=120)
    job_title: str = Field(..., min_length=1, max_length=120)
    skills: str = Field("", max_length=500)
    interest: str = Field("", max_length=600)
    job_description: str = Field("", max_length=6000)


class CoverLetterOut(BaseModel):
    letter: str


class ResumeTextOut(BaseModel):
    text: str
    words: int
    truncated: bool


_COVER_LETTER_SYSTEM = guarded(
    "You write cover letters for job applicants. Write one letter, 230-320 words, "
    "plain text, no markdown, no placeholders in square brackets except where the "
    "applicant's name is missing. Open with 'Dear Hiring Manager,' and close with "
    "'Sincerely,' followed by the applicant's name. Be specific to the company and "
    "role, connect the applicant's skills to what the role needs, and avoid cliches "
    "such as 'I am writing to express my interest'. Never invent employers, "
    "degrees, years of experience or metrics the applicant did not give."
)


@router.post(
    "/cover-letter",
    response_model=CoverLetterOut,
    summary="Write a cover letter with AI",
    dependencies=[Depends(_cover_letter_limit)],
)
def cover_letter(payload: CoverLetterIn) -> CoverLetterOut:
    """503 when no model is available: the page falls back to its template."""
    if not gemini_client.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "AI writing is not available")
    details = "\n".join(
        [
            f"Applicant name: {payload.name.strip() or '[Your Name]'}",
            f"Company: {payload.company.strip()}",
            f"Role: {payload.job_title.strip()}",
            f"Skills: {payload.skills.strip() or 'not given'}",
            f"Why this company: {payload.interest.strip() or 'not given'}",
        ]
    )
    prompt = fence(details, label="applicant details")
    if payload.job_description.strip():
        prompt += "\n\n" + fence(payload.job_description.strip(), label="job posting")
    try:
        letter = gemini_client.generate(_COVER_LETTER_SYSTEM, prompt)
    except gemini_client.GeminiUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "AI writing is not available")
    return CoverLetterOut(letter=letter)


@router.post(
    "/resume-text",
    response_model=ResumeTextOut,
    summary="Extract the text of a resume file",
    dependencies=[Depends(_resume_text_limit)],
)
async def resume_text(file: UploadFile = File(...)) -> ResumeTextOut:
    """PDF or DOCX in, plain text out — so the resume score tool can take a file."""
    filename = safe_upload_filename(file.filename, fallback="resume")
    suffix = suffix_for(filename)
    if suffix is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"{filename}: upload a .pdf or .docx file"
        )
    data = await read_capped(file, _MAX_RESUME_BYTES, filename=filename)
    try:
        text = await run_in_threadpool(extract_text, suffix, data)
    except Exception as exc:  # noqa: BLE001 - any parser failure is "unreadable"
        logger.info("public resume-text could not read a file: %s", type(exc).__name__)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"{filename}: could not be read"
        ) from None
    text = (text or "").strip()
    if not text:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"{filename}: no text found — is it a scanned image? Paste the text instead.",
        )
    truncated = len(text) > _MAX_RESUME_CHARS
    text = text[:_MAX_RESUME_CHARS]
    return ResumeTextOut(text=text, words=len(text.split()), truncated=truncated)
