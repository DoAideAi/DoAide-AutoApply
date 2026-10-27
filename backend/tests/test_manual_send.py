"""Manual sending — outreach without a connected Gmail.

While Google's verification of the Gmail scopes is pending, most users cannot
connect a mailbox. Outreach still runs: every message lands as a draft, the user
sends it from Gmail's compose window, and ``mark-sent`` books the delivery.
"""
from __future__ import annotations

import pytest

from app.models.application import Application, ApplicationStatus
from app.models.email import Email, EmailDirection, EmailStatus
from app.models.email_thread import EmailThread
from app.services import auto_apply_service, recruiter_discovery, send_policy
from app.services.career_scraper import Contact, ScrapeResult
from app.tasks import email_tasks


@pytest.fixture()
def stub_scraper(monkeypatch):
    def _fake(db, company, domain=None, **kwargs):
        slug = company.lower().replace(" ", "")
        return ScrapeResult(
            company=company,
            domain=f"{slug}.com",
            contacts=[Contact(email=f"talent@{slug}.com", confidence=0.9)],
        )

    monkeypatch.setattr(recruiter_discovery, "get_or_scrape", _fake)


@pytest.fixture()
def manual(auth_client, resume, stub_scraper):
    """A signed-in user with a resume and no mailbox."""
    return auth_client


def _outreach(db) -> Email:
    return db.query(Email).filter_by(direction=EmailDirection.SENT).first()


def test_campaign_starts_without_gmail_and_drafts(manual, db_session):
    res = manual.post(
        "/api/v1/campaigns", json={"target_companies": ["Acme"], "auto_send": True}
    )
    assert res.status_code < 300, res.text

    # Asked to auto-send, but there is nothing to send from.
    assert _outreach(db_session).status == EmailStatus.DRAFT

    queue = manual.get("/api/v1/review").json()
    assert queue["manual_send"] is True
    assert queue["count"] == 1
    assert queue["auto_send"]["blocked_reason_code"] == send_policy.REASON_MANUAL


def test_mark_sent_books_the_delivery(manual, db_session):
    manual.post("/api/v1/campaigns", json={"target_companies": ["Acme"]})
    email = _outreach(db_session)

    res = manual.post(f"/api/v1/review/emails/{email.id}/mark-sent")
    assert res.status_code == 200, res.text

    db_session.expire_all()
    email = db_session.get(Email, email.id)
    assert email.status == EmailStatus.SENT
    assert email.sent_at is not None
    application = db_session.query(Application).first()
    assert application.status == ApplicationStatus.OUTREACH_SENT
    assert manual.get("/api/v1/review").json()["count"] == 0


def test_mark_sent_refuses_a_message_already_sent(manual, db_session):
    manual.post("/api/v1/campaigns", json={"target_companies": ["Acme"]})
    email = _outreach(db_session)
    manual.post(f"/api/v1/review/emails/{email.id}/mark-sent")

    again = manual.post(f"/api/v1/review/emails/{email.id}/mark-sent")
    assert again.status_code == 409


def test_a_connected_mailbox_still_auto_sends(
    auth_client, connected_gmail, current_user, db_session
):
    decision = send_policy.evaluate(db_session, current_user, None, intent=True)
    assert decision.enabled
    assert auth_client.get("/api/v1/review").json()["manual_send"] is False


def test_queued_mail_with_no_mailbox_is_parked_not_failed(
    manual, db_session, monkeypatch
):
    manual.post("/api/v1/campaigns", json={"target_companies": ["Acme"]})
    email = _outreach(db_session)
    # As a follow-up arrives: queued without asking the send policy.
    email.status = EmailStatus.QUEUED
    db_session.commit()
    email_id = email.id

    monkeypatch.setattr(email_tasks, "SessionLocal", lambda: db_session)
    result = email_tasks.send_outreach_email.run(email_id)

    assert result["status"] == "held"
    db_session.expire_all()
    parked = db_session.get(Email, email_id)
    assert parked.status == EmailStatus.DRAFT
    assert parked.attention_reason == email_tasks.MANUAL_SEND_NOTE


def test_manual_headroom_is_the_unsent_backlog(manual, db_session, current_user):
    cap = auto_apply_service.MANUAL_DRAFT_BACKLOG
    assert auto_apply_service.send_headroom(db_session, current_user) == (cap, cap)

    manual.post("/api/v1/campaigns", json={"target_companies": ["Acme"]})
    assert auto_apply_service.send_headroom(db_session, current_user) == (cap - 1, cap)

    thread = db_session.query(EmailThread).first()
    assert thread.gmail_account_id is None


def test_autopilot_turns_on_without_gmail(manual):
    res = manual.put("/api/v1/autopilot", json={"is_active": True})
    assert res.status_code == 200, res.text
    assert res.json()["is_active"] is True
