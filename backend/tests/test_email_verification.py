"""Pre-send recipient verification.

The suite runs with ``EMAIL_MX_CHECK_ENABLED=false`` so nothing touches DNS;
the tests here that need the MX step switch it on and swap the resolver for a
fake that answers from a table.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import dns.asyncresolver
import dns.exception
import dns.name
import dns.resolver
import pytest

from app.core.config import settings
from app.models.application import Application, ApplicationStatus
from app.models.campaign import Campaign
from app.models.email import Email, EmailDirection, EmailStatus
from app.models.email_bounce import BounceKind, EmailBounce
from app.models.email_thread import EmailThread
from app.models.recruiter import DeliveryState, EmailVerification, Recruiter
from app.models.user import User
from app.services import email_verification as ev


def _recruiter(db, user, email="talent@acme.com", **overrides) -> Recruiter:
    defaults = dict(user_id=user.id, email=email, company="Acme")
    defaults.update(overrides)
    row = Recruiter(**defaults)
    db.add(row)
    db.commit()
    return row


class _Mx:
    def __init__(self, exchange: str):
        self.exchange = dns.name.root if exchange == "." else dns.name.from_text(exchange)


class FakeResolver:
    """Answers from ``table[(domain, rdtype)]``: a list of records, or an exception."""

    table: dict = {}
    calls: list = []

    def __init__(self):
        self.lifetime = None

    async def resolve(self, domain, rdtype):
        FakeResolver.calls.append((domain, rdtype))
        answer = FakeResolver.table.get((domain, rdtype), dns.resolver.NoAnswer())
        if isinstance(answer, Exception):
            raise answer
        return answer


@pytest.fixture()
def dns_table(monkeypatch):
    monkeypatch.setattr(settings, "email_mx_check_enabled", True)
    monkeypatch.setattr(dns.asyncresolver, "Resolver", FakeResolver)
    FakeResolver.table = {}
    FakeResolver.calls = []
    ev.clear_mx_cache()
    yield FakeResolver.table
    ev.clear_mx_cache()


class TestFormat:
    @pytest.mark.parametrize(
        "address",
        ["", None, "n/a", "john at acme.com", "john@acme", "a@@acme.com", "a b@acme.com",
         "john@-acme.com"],
    )
    def test_malformed_addresses_are_undeliverable(self, address):
        verdict = ev.check_format(address)
        assert verdict is not None
        assert verdict.status is EmailVerification.UNDELIVERABLE
        assert not verdict.sendable

    @pytest.mark.parametrize(
        "address", ["talent@acme.com", "first.last+jobs@sub.acme.co.in", " hr@acme.io "]
    )
    def test_well_formed_addresses_pass(self, address):
        assert ev.check_format(address) is None


class TestDisposable:
    @pytest.mark.parametrize(
        "domain", ["mailinator.com", "YOPMAIL.com", "x.y.mailinator.com", "guerrillamail.com."]
    )
    def test_disposable_domains_and_their_subdomains(self, domain):
        assert ev.is_disposable(domain)

    @pytest.mark.parametrize("domain", ["acme.com", "gmail.com", "notmailinator.com", "com"])
    def test_ordinary_domains(self, domain):
        assert not ev.is_disposable(domain)

    def test_check_disposable_verdict(self):
        verdict = ev.check_disposable("someone@mailinator.com")
        assert verdict.status is EmailVerification.UNDELIVERABLE
        assert "Disposable" in verdict.reason
        assert ev.check_disposable("someone@acme.com") is None


class TestBounced:
    def test_this_rows_hard_bounce(self, db_session, current_user):
        row = _recruiter(db_session, current_user, delivery_state=DeliveryState.HARD_BOUNCED)
        assert ev.check_bounced(db_session, row.email, row).status is (
            EmailVerification.UNDELIVERABLE
        )

    def _bounce(self, db, user, address, *, kind=BounceKind.HARD, matched=True):
        email_id = None
        if matched:
            campaign = Campaign(user_id=user.id, name="c")
            db.add(campaign)
            db.flush()
            row = _recruiter(db, user, email=address)
            application = Application(
                user_id=user.id, campaign_id=campaign.id, recruiter_id=row.id,
                status=ApplicationStatus.OUTREACH_SENT,
            )
            db.add(application)
            db.flush()
            thread = EmailThread(application_id=application.id, subject="s")
            db.add(thread)
            db.flush()
            email = Email(
                thread_id=thread.id, direction=EmailDirection.SENT, status=EmailStatus.SENT,
                to_address=address, subject="s", body_text="b",
            )
            db.add(email)
            db.flush()
            email_id = email.id
        db.add(EmailBounce(
            user_id=user.id, email_id=email_id, address=address,
            domain=address.split("@")[1], kind=kind, occurred_at=datetime.now(UTC),
        ))
        db.commit()

    def test_another_users_matched_hard_bounce_counts(self, db_session, current_user):
        other = User(email="other@example.com", hashed_password="x")
        db_session.add(other)
        db_session.commit()
        self._bounce(db_session, other, "gone@acme.com")

        verdict = ev.check_bounced(db_session, "Gone@Acme.com ")
        assert verdict is not None and not verdict.sendable

    def test_soft_or_unmatched_bounces_do_not(self, db_session, current_user):
        self._bounce(db_session, current_user, "full@acme.com", kind=BounceKind.SOFT)
        self._bounce(db_session, current_user, "forged@acme.com", matched=False)
        assert ev.check_bounced(db_session, "full@acme.com") is None
        assert ev.check_bounced(db_session, "forged@acme.com") is None


class TestMx:
    def test_mx_records_accept(self, dns_table):
        dns_table[("acme.com", "MX")] = [_Mx("mx1.acme.com.")]
        assert asyncio.run(ev.mx_status("acme.com")) is ev.MxStatus.ACCEPTS

    def test_null_mx_rejects(self, dns_table):
        dns_table[("sendonly.com", "MX")] = [_Mx(".")]
        assert asyncio.run(ev.mx_status("sendonly.com")) is ev.MxStatus.NO_MAIL

    def test_nxdomain_rejects(self, dns_table):
        dns_table[("nope.invalid", "MX")] = dns.resolver.NXDOMAIN()
        assert asyncio.run(ev.mx_status("nope.invalid")) is ev.MxStatus.NO_MAIL

    def test_no_mx_falls_back_to_an_address_record(self, dns_table):
        dns_table[("bare.com", "AAAA")] = ["::1"]
        assert asyncio.run(ev.mx_status("bare.com")) is ev.MxStatus.ACCEPTS
        assert ("bare.com", "A") in FakeResolver.calls

    def test_no_mx_and_no_address_rejects(self, dns_table):
        assert asyncio.run(ev.mx_status("parked.com")) is ev.MxStatus.NO_MAIL

    def test_timeout_is_unknown_and_not_cached(self, dns_table):
        dns_table[("slow.com", "MX")] = dns.exception.Timeout()
        assert asyncio.run(ev.mx_status("slow.com")) is ev.MxStatus.UNKNOWN
        dns_table[("slow.com", "MX")] = [_Mx("mx.slow.com.")]
        assert asyncio.run(ev.mx_status("slow.com")) is ev.MxStatus.ACCEPTS

    def test_an_unexpected_error_is_unknown(self, dns_table):
        dns_table[("bug.com", "MX")] = RuntimeError("resolver bug")
        assert asyncio.run(ev.mx_status("bug.com")) is ev.MxStatus.UNKNOWN

    def test_answers_are_cached_per_domain(self, dns_table):
        dns_table[("acme.com", "MX")] = [_Mx("mx1.acme.com.")]
        asyncio.run(ev.mx_status("acme.com"))
        asyncio.run(ev.mx_status("ACME.com."))
        assert FakeResolver.calls == [("acme.com", "MX")]

    def test_negative_answers_expire_sooner(self, dns_table, monkeypatch):
        monkeypatch.setattr(settings, "email_mx_negative_cache_ttl_seconds", 0)
        dns_table[("moving.com", "MX")] = dns.resolver.NXDOMAIN()
        assert asyncio.run(ev.mx_status("moving.com")) is ev.MxStatus.NO_MAIL
        dns_table[("moving.com", "MX")] = [_Mx("mx.moving.com.")]
        assert asyncio.run(ev.mx_status("moving.com")) is ev.MxStatus.ACCEPTS

    def test_many_domains_resolve_concurrently_and_deduplicate(self, dns_table):
        dns_table[("a.com", "MX")] = [_Mx("mx.a.com.")]
        dns_table[("b.com", "MX")] = dns.resolver.NXDOMAIN()
        result = asyncio.run(ev.mx_statuses(["a.com", "A.com", "b.com"]))
        assert result == {"a.com": ev.MxStatus.ACCEPTS, "b.com": ev.MxStatus.NO_MAIL}
        assert sorted(FakeResolver.calls) == [("a.com", "MX"), ("b.com", "MX")]

    def test_disabled_check_never_resolves(self, dns_table, monkeypatch):
        monkeypatch.setattr(settings, "email_mx_check_enabled", False)
        assert asyncio.run(ev.mx_status("anything.com")) is ev.MxStatus.ACCEPTS
        assert FakeResolver.calls == []

    def test_prefetch_warms_the_cache_from_sync_code(self, dns_table):
        dns_table[("acme.com", "MX")] = [_Mx("mx1.acme.com.")]
        ev.prefetch_domains(["a@acme.com", "b@acme.com", "junk"])
        assert ev._cached("acme.com") is ev.MxStatus.ACCEPTS


class TestVerifyAddress:
    def test_cheap_checks_run_before_dns(self, db_session, dns_table):
        verdict = ev.verify_address(db_session, "x@mailinator.com")
        assert not verdict.sendable
        assert FakeResolver.calls == []

    def test_a_domain_without_mail_is_undeliverable(self, db_session, dns_table):
        dns_table[("parked.com", "MX")] = dns.resolver.NXDOMAIN()
        verdict = ev.verify_address(db_session, "careers@parked.com")
        assert verdict.status is EmailVerification.UNDELIVERABLE
        assert "parked.com" in verdict.reason

    def test_an_inconclusive_lookup_still_sends(self, db_session, dns_table):
        dns_table[("slow.com", "MX")] = dns.exception.Timeout()
        verdict = ev.verify_address(db_session, "hr@slow.com")
        assert verdict.status is EmailVerification.UNKNOWN
        assert verdict.sendable

    def test_deliverable(self, db_session, dns_table):
        dns_table[("acme.com", "MX")] = [_Mx("mx1.acme.com.")]
        assert ev.verify_address(db_session, "talent@acme.com") is ev.DELIVERABLE

    def test_async_entry_point(self, db_session, dns_table):
        dns_table[("acme.com", "MX")] = [_Mx("mx1.acme.com.")]
        assert asyncio.run(ev.verify_address_async(db_session, "talent@acme.com")).sendable
        assert not asyncio.run(ev.verify_address_async(db_session, "nope")).sendable


class TestEnsureVerified:
    def test_stores_the_verdict_on_the_recruiter(self, db_session, current_user, dns_table):
        dns_table[("parked.com", "MX")] = dns.resolver.NXDOMAIN()
        row = _recruiter(db_session, current_user, email="careers@parked.com")
        assert row.email_verification is EmailVerification.UNVERIFIED

        verdict = ev.ensure_verified(db_session, row)
        db_session.commit()

        assert not verdict.sendable
        assert row.email_verification is EmailVerification.UNDELIVERABLE
        assert row.email_verified_at is not None
        assert "does not accept email" in row.email_verification_reason
        assert ev.is_undeliverable(db_session, row)

    def test_a_fresh_verdict_is_reused(self, db_session, current_user, dns_table):
        dns_table[("acme.com", "MX")] = [_Mx("mx1.acme.com.")]
        row = _recruiter(db_session, current_user)
        ev.ensure_verified(db_session, row)
        ev.clear_mx_cache()
        FakeResolver.calls.clear()

        assert ev.ensure_verified(db_session, row).sendable
        assert FakeResolver.calls == []

    def test_a_stale_verdict_is_rechecked(self, db_session, current_user, dns_table):
        dns_table[("acme.com", "MX")] = dns.resolver.NXDOMAIN()
        now = datetime.now(UTC)
        row = _recruiter(
            db_session, current_user,
            email_verification=EmailVerification.DELIVERABLE,
            email_verified_at=now - timedelta(days=settings.email_verification_ttl_days + 1),
        )
        assert not ev.ensure_verified(db_session, row, now=now).sendable
        assert row.email_verification is EmailVerification.UNDELIVERABLE

    def test_a_hard_bounce_overrides_a_fresh_deliverable(self, db_session, current_user):
        row = _recruiter(
            db_session, current_user,
            email_verification=EmailVerification.DELIVERABLE,
            email_verified_at=datetime.now(UTC),
            delivery_state=DeliveryState.HARD_BOUNCED,
        )
        assert not ev.ensure_verified(db_session, row).sendable
        assert row.email_verification is EmailVerification.UNDELIVERABLE

    def test_unknown_is_always_rechecked(self, db_session, current_user, dns_table):
        dns_table[("acme.com", "MX")] = [_Mx("mx1.acme.com.")]
        row = _recruiter(
            db_session, current_user,
            email_verification=EmailVerification.UNKNOWN,
            email_verified_at=datetime.now(UTC),
        )
        ev.ensure_verified(db_session, row)
        assert row.email_verification is EmailVerification.DELIVERABLE

    def test_no_recruiter_is_not_undeliverable(self, db_session):
        assert not ev.is_undeliverable(db_session, None)


class TestSendGate:
    def _queued(self, db, user, resume, address, recruiter_email=None):
        campaign = Campaign(user_id=user.id, name="c", resume_id=resume.id)
        recruiter = Recruiter(user_id=user.id, email=recruiter_email or address, company="Acme")
        db.add_all([campaign, recruiter])
        db.flush()
        application = Application(
            user_id=user.id, campaign_id=campaign.id, recruiter_id=recruiter.id,
            status=ApplicationStatus.QUEUED,
        )
        db.add(application)
        db.flush()
        thread = EmailThread(application_id=application.id, subject="s")
        db.add(thread)
        db.flush()
        email = Email(
            thread_id=thread.id, direction=EmailDirection.SENT, status=EmailStatus.QUEUED,
            to_address=address, subject="s", body_text="b",
        )
        db.add(email)
        db.commit()
        return email.id, recruiter.id

    @pytest.mark.parametrize("address", ["hr@mailinator.com", "careers@parked.com"])
    def test_an_undeliverable_recipient_is_skipped_not_sent(
        self, db_session, current_user, connected_gmail, resume, monkeypatch, dns_table,
        address,
    ):
        from app.tasks import email_tasks

        dns_table[("parked.com", "MX")] = dns.resolver.NXDOMAIN()
        email_id, recruiter_id = self._queued(db_session, current_user, resume, address)
        monkeypatch.setattr(email_tasks, "SessionLocal", lambda: db_session)
        sent: list = []
        monkeypatch.setattr(email_tasks.gmail_service, "send_email", lambda **kw: sent.append(kw))

        result = email_tasks.send_outreach_email.run(email_id)

        assert result == {
            "email_id": email_id, "status": "failed", "reason": "recipient undeliverable",
        }
        assert sent == []
        db_session.expire_all()
        assert db_session.get(Email, email_id).status == EmailStatus.FAILED
        recruiter = db_session.get(Recruiter, recruiter_id)
        assert recruiter.email_verification is EmailVerification.UNDELIVERABLE

    def test_a_to_address_differing_from_the_contact_is_checked_itself(
        self, db_session, current_user, connected_gmail, resume, monkeypatch, dns_table,
    ):
        from app.tasks import email_tasks

        dns_table[("acme.com", "MX")] = [_Mx("mx1.acme.com.")]
        email_id, _ = self._queued(
            db_session, current_user, resume, "x@mailinator.com",
            recruiter_email="talent@acme.com",
        )
        monkeypatch.setattr(email_tasks, "SessionLocal", lambda: db_session)
        sent: list = []
        monkeypatch.setattr(email_tasks.gmail_service, "send_email", lambda **kw: sent.append(kw))

        assert email_tasks.send_outreach_email.run(email_id)["status"] == "failed"
        assert sent == []
