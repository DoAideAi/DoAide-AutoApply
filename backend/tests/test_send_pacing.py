"""Pacing across dispatchers: one mailbox never sends twice inside the gap.

Each dispatcher spaces its own batch, but counts from zero — so two campaigns
resumed together, or a follow-up sweep landing mid-campaign, could put two
messages out of one personal Gmail in the same second. The send task now holds
a message back until ``MIN_SEND_INTERVAL_SECONDS`` have passed since the
mailbox last sent, without spending the reputation gate's retry budget.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.services import crypto
from app.core.config import settings
from app.models.application import Application, ApplicationStatus
from app.models.campaign import Campaign, CampaignStatus
from app.models.email import Email, EmailDirection, EmailStatus, ReplyTemplate
from app.models.email_thread import EmailThread
from app.models.gmail_account import GmailAccount
from app.models.recruiter import Recruiter
from app.models.user import User
from app.services import gmail_service, reputation_service
from app.tasks import email_tasks

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)


class TestSpacingWait:
    def _account(self, last_used_at):
        return GmailAccount(email="a@gmail.com", last_used_at=last_used_at)

    def test_never_sent_does_not_wait(self):
        assert reputation_service.spacing_wait(self._account(None), now=NOW) is None

    def test_no_mailbox_does_not_wait(self):
        assert reputation_service.spacing_wait(None, now=NOW) is None

    def test_waits_out_the_rest_of_the_gap(self, monkeypatch):
        monkeypatch.setattr(settings, "min_send_interval_seconds", 90)
        wait = reputation_service.spacing_wait(
            self._account(NOW - timedelta(seconds=30)), now=NOW
        )
        assert wait == timedelta(seconds=60)

    def test_gap_elapsed_does_not_wait(self, monkeypatch):
        monkeypatch.setattr(settings, "min_send_interval_seconds", 90)
        account = self._account(NOW - timedelta(seconds=90))
        assert reputation_service.spacing_wait(account, now=NOW) is None

    def test_future_stamp_is_skew_not_a_day_long_wait(self, monkeypatch):
        monkeypatch.setattr(settings, "min_send_interval_seconds", 90)
        account = self._account(NOW + timedelta(hours=5))
        assert reputation_service.spacing_wait(account, now=NOW) is None

    def test_naive_stamp_is_read_as_utc(self, monkeypatch):
        monkeypatch.setattr(settings, "min_send_interval_seconds", 90)
        account = self._account((NOW - timedelta(seconds=10)).replace(tzinfo=None))
        assert reputation_service.spacing_wait(account, now=NOW) == timedelta(seconds=80)


# --------------------------------------------------------------------------- #
# The send task                                                                #
# --------------------------------------------------------------------------- #


@pytest.fixture()
def world(db_session: Session, monkeypatch):
    user = User(email="pace@example.com", hashed_password="x", full_name="Pat Pace")
    db_session.add(user)
    db_session.flush()
    account = GmailAccount(
        user_id=user.id,
        email="pat@gmail.com",
        google_sub="pace-sub",
        display_name="Pat Pace",
        refresh_token_encrypted=crypto.encrypt("fake"),
        scopes="openid https://www.googleapis.com/auth/gmail.send",
        status="connected",
        is_primary=True,
    )
    campaign = Campaign(user_id=user.id, name="C", status=CampaignStatus.ACTIVE)
    recruiter = Recruiter(user_id=user.id, email="sam@acme.com", name="Sam")
    db_session.add_all([account, campaign, recruiter])
    db_session.flush()
    app_row = Application(
        user_id=user.id,
        campaign_id=campaign.id,
        recruiter_id=recruiter.id,
        status=ApplicationStatus.QUEUED,
    )
    db_session.add(app_row)
    db_session.flush()
    thread = EmailThread(application_id=app_row.id)
    db_session.add(thread)
    db_session.flush()
    email = Email(
        thread_id=thread.id,
        direction=EmailDirection.SENT,
        status=EmailStatus.QUEUED,
        to_address="sam@acme.com",
        subject="Backend role",
        body_text="Hi Sam, keen to talk.",
    )
    db_session.add(email)
    db_session.commit()

    monkeypatch.setattr(email_tasks, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    monkeypatch.setattr(settings, "celery_enabled", True)
    monkeypatch.setattr(settings, "min_send_interval_seconds", 90)
    monkeypatch.setattr(settings, "email_tracking_enabled", False)

    sends: list[dict] = []

    def fake_send(**kwargs):
        sends.append(kwargs)
        return gmail_service.SentMessage(
            gmail_message_id=f"m{len(sends)}", gmail_thread_id="t1", rfc_message_id=None
        )

    monkeypatch.setattr(email_tasks.gmail_service, "send_email", fake_send)
    published: list[dict] = []
    monkeypatch.setattr(
        email_tasks.send_outreach_email,
        "apply_async",
        lambda args, countdown: published.append({"args": args, "countdown": countdown}),
    )
    return {"account": account, "email": email, "sends": sends, "published": published}


def test_first_send_from_a_mailbox_goes_straight_out(world):
    result = email_tasks.send_outreach_email(world["email"].id)
    assert result["status"] == "sent"
    assert len(world["sends"]) == 1
    assert world["published"] == []


def test_a_send_inside_the_gap_is_deferred_not_sent(world, db_session):
    world["account"].last_used_at = datetime.now(UTC) - timedelta(seconds=20)
    db_session.commit()

    result = email_tasks.send_outreach_email(world["email"].id)

    assert result["status"] == "deferred"
    assert world["sends"] == []
    [again] = world["published"]
    assert again["args"] == [world["email"].id]
    # The rest of the 90s gap (about 70s), plus 5-30s of jitter.
    assert 70 <= again["countdown"] <= 100
    db_session.refresh(world["email"])
    assert world["email"].status == EmailStatus.QUEUED
    assert world["email"].send_dispatched_at is not None


def test_once_the_gap_has_passed_it_sends(world, db_session):
    world["account"].last_used_at = datetime.now(UTC) - timedelta(seconds=120)
    db_session.commit()
    assert email_tasks.send_outreach_email(world["email"].id)["status"] == "sent"


def test_an_answer_to_a_recruiter_is_not_held_back(world, db_session):
    world["account"].last_used_at = datetime.now(UTC) - timedelta(seconds=5)
    world["email"].draft_template = ReplyTemplate.INTERESTED
    db_session.commit()
    assert email_tasks.send_outreach_email(world["email"].id)["status"] == "sent"
    assert world["published"] == []
