"""Direct Apply — import a job from any URL and get ready to apply to it."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.smart_apply import CoverLetterOut


class DirectImportRequest(BaseModel):
    url: str = Field(min_length=4, max_length=2000)
    # For pages that render the posting in JavaScript: the candidate's own copy
    # of the description, used in place of the fetched text.
    description: str | None = Field(default=None, max_length=50000)
    resume_id: int | None = None


class DirectLetterRequest(BaseModel):
    # Replace a letter the candidate has edited. Off by default.
    force: bool = False


class DirectJobOut(BaseModel):
    """One imported job, as the tracker lists it."""

    id: int
    title: str | None = None
    company: str | None = None
    location: str | None = None
    remote: bool | None = None
    url: str | None = None
    # Where the application form is, when the page told us; else the posting.
    apply_url: str | None = None
    apply_email: str | None = None
    ats_key: str | None = None
    ats_label: str | None = None
    # "ats" or "board".
    ats_kind: str | None = None
    status: str
    applied_at: datetime | None = None
    fit_score: float | None = None
    created_at: datetime
    updated_at: datetime


class DirectRequirements(BaseModel):
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    years_required: int | None = None
    seniority: str | None = None
    salary_text: str | None = None


class DirectFitOut(BaseModel):
    overall: float
    recommendation: str
    summary: str | None = None
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)


class FormAnswer(BaseModel):
    label: str
    value: str


class DirectFormData(BaseModel):
    """What an application form will ask, ready to copy."""

    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    website_url: str | None = None
    headline: str | None = None
    years_experience: int | None = None
    resume_id: int | None = None
    resume_filename: str | None = None
    answers: list[FormAnswer] = Field(default_factory=list)
    # Fields most forms ask that we have no answer for yet.
    missing: list[str] = Field(default_factory=list)


class DirectApplyOut(BaseModel):
    """An imported job with everything prepared to apply."""

    job: DirectJobOut
    description: str | None = None
    requirements: DirectRequirements
    fit: DirectFitOut | None = None
    cover_letter: CoverLetterOut | None = None
    form: DirectFormData
    # True on the import that first created the job.
    created: bool = False
