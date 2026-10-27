"""Direct Apply — apply to a job on any company's own site.

    POST   /direct-apply/import               -> import a posting by URL, score it,
                                                 write the letter, prepare the form
    GET    /direct-apply                      -> imported jobs, newest first
    GET    /direct-apply/{id}                 -> one job with everything prepared
    POST   /direct-apply/{id}/cover-letter    -> write the letter again (Gemini)
    POST   /direct-apply/{id}/applied         -> the candidate submitted the form
    DELETE /direct-apply/{id}/applied         -> take that back

Editing the letter is the existing ``PATCH /cover-letter/{id}``. See
:mod:`app.services.direct_apply_service` for the design.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.rate_limit import rate_limit
from app.models.job import JobPosting
from app.models.user import User
from app.schemas.direct_apply import (
    DirectApplyOut,
    DirectFitOut,
    DirectFormData,
    DirectImportRequest,
    DirectJobOut,
    DirectLetterRequest,
    DirectRequirements,
)
from app.schemas.smart_apply import CoverLetterOut
from app.services import cover_letter_service, usage_events
from app.services import direct_apply_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/direct-apply", tags=["direct-apply"])

# Each import fetches a page and makes up to two LLM calls.
_import_limit = rate_limit(10, 60, scope="direct-apply")


def _job_out(posting: JobPosting) -> DirectJobOut:
    info = svc.apply_info(posting)
    return DirectJobOut(
        id=posting.id,
        title=posting.title,
        company=posting.company,
        location=posting.location,
        remote=posting.remote,
        url=posting.url,
        apply_url=info.url,
        apply_email=info.email,
        ats_key=info.vendor.key if info.vendor else None,
        ats_label=info.vendor.label if info.vendor else None,
        ats_kind=info.vendor.kind if info.vendor else None,
        status=posting.status.value,
        applied_at=posting.applied_at,
        fit_score=posting.fit_score,
        created_at=posting.created_at,
        updated_at=posting.updated_at,
    )


def _fit_out(row) -> DirectFitOut | None:
    if row is None:
        return None
    return DirectFitOut(
        overall=row.overall,
        recommendation=row.recommendation or "poor",
        summary=row.summary,
        matched_skills=row.matched_skills or [],
        missing_skills=row.missing_skills or [],
    )


def _letter_out(letter) -> CoverLetterOut | None:
    if letter is None:
        return None
    out = CoverLetterOut.model_validate(letter)
    out.full_text = letter.full_text
    return out


def _requirements(job) -> DirectRequirements:
    return DirectRequirements(
        required_skills=job.required_skills,
        preferred_skills=job.preferred_skills,
        responsibilities=job.responsibilities,
        years_required=job.years_required,
        seniority=job.seniority,
        salary_text=job.salary_text,
    )


def _owned(db: Session, user: User, job_id: int) -> JobPosting:
    try:
        return svc.get_owned(db, user, job_id)
    except svc.DirectApplyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/import",
    response_model=DirectApplyOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_import_limit)],
)
def import_job(
    payload: DirectImportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DirectApplyOut:
    """Import a posting by URL and prepare the application."""
    try:
        result = svc.import_job(
            db,
            user,
            payload.url,
            description=payload.description,
            resume_id=payload.resume_id,
        )
    except svc.NoResumeError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except svc.DirectApplyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    usage_events.record(
        db,
        "direct_apply.imported",
        user_id=user.id,
        created=result.created,
        ats=result.target.vendor.key if result.target.vendor else None,
        found_apply_link=bool(result.target.apply_url),
    )
    db.commit()
    db.refresh(result.posting)
    return DirectApplyOut(
        job=_job_out(result.posting),
        description=result.posting.description,
        requirements=_requirements(result.job),
        fit=_fit_out(result.fit),
        cover_letter=_letter_out(result.letter),
        form=DirectFormData(**svc.form_data(db, user, result.resume)),
        created=result.created,
    )


@router.get("", response_model=list[DirectJobOut])
def list_jobs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DirectJobOut]:
    return [_job_out(posting) for posting in svc.list_direct(db, user)]


@router.get("/{job_id}", response_model=DirectApplyOut)
def get_job(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DirectApplyOut:
    posting = _owned(db, user, job_id)
    return DirectApplyOut(
        job=_job_out(posting),
        description=posting.description,
        requirements=_requirements(svc.parsed_job(posting)),
        fit=_fit_out(svc.latest_fit(db, posting)),
        cover_letter=_letter_out(cover_letter_service.get_letter(db, user.id, posting.id)),
        form=DirectFormData(**svc.form_data(db, user, svc.latest_resume(db, user, posting))),
    )


@router.post(
    "/{job_id}/cover-letter",
    response_model=CoverLetterOut,
    dependencies=[Depends(_import_limit)],
)
def rewrite_letter(
    job_id: int,
    payload: DirectLetterRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CoverLetterOut:
    posting = _owned(db, user, job_id)
    try:
        letter = svc.rewrite_letter(
            db, user, posting, force=bool(payload and payload.force)
        )
    except svc.NoResumeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    db.commit()
    db.refresh(letter)
    return _letter_out(letter)


@router.post("/{job_id}/applied", response_model=DirectJobOut)
def mark_applied(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DirectJobOut:
    posting = svc.set_applied(_owned(db, user, job_id), True)
    usage_events.record(db, "direct_apply.applied", user_id=user.id)
    db.commit()
    db.refresh(posting)
    return _job_out(posting)


@router.delete("/{job_id}/applied", response_model=DirectJobOut)
def unmark_applied(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DirectJobOut:
    posting = svc.set_applied(_owned(db, user, job_id), False)
    db.commit()
    db.refresh(posting)
    return _job_out(posting)
