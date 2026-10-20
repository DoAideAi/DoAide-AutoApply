"""Pre-send recipient verification — "is there any reason to think this is dead?"

``bounce_service`` learns an address is bad from the bounce, which is to say
after the send that cost a slot in the warm-up ramp and a mark against the
mailbox's reputation. Most of the addresses that bounce here could have been
called before that, because the scraper guesses: when a careers page publishes
nothing, ``career_scraper.pattern_contacts`` offers ``careers@``/``hr@``/
``talent@`` on whatever domain it resolved, and nothing ever asked whether that
domain takes mail at all.

Four checks, cheapest first, the first failure wins:

1. **Syntax** — a quick regex, then ``email_validator``'s RFC parser.
2. **Disposable domain** — a throwaway inbox is never a recruiter.
3. **Already bounced** — this user's row hard-bounced, or *any* user's mail to
   the exact address hard-bounced. A 5.1.1 is a fact about the address, and the
   per-user ``delivery_state`` meant every new user found it out again with a
   send of their own.
4. **Domain accepts mail** — MX records, else the RFC 5321 §5.1 implicit MX
   (an A/AAAA record). NXDOMAIN, a null MX (RFC 7505) or no records at all is
   undeliverable. Async, with a per-domain cache: a campaign is mostly many
   addresses at a few domains.

What this cannot do is prove a mailbox exists. ``talent@`` at a domain with
perfectly good MX can still 5.1.1, and the only way to know first is an SMTP
``RCPT TO`` probe — which mail providers treat as directory harvesting and
which would cost the very reputation this module exists to protect. That case
is left to ``bounce_service``, and check 3 makes sure it only costs one send
across every user rather than one each.

**Unknown sends.** A DNS timeout or SERVFAIL is ``UNKNOWN``, which callers treat
as sendable: a flaky resolver on our side is not evidence about the recipient,
and failing closed would stop all mail whenever DNS hiccups.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import enum
import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import dns.asyncresolver
import dns.exception
import dns.name
import dns.resolver
from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.email_bounce import BounceKind, EmailBounce
from app.models.recruiter import DeliveryState, EmailVerification, Recruiter

logger = logging.getLogger(__name__)

# Deliberately loose: one ``@``, no whitespace, a dot in the domain. It exists to
# throw out obvious junk ("n/a", "john at acme") before the strict parser, not to
# be the definition of an address.
_BASIC_FORMAT = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Disposable / temporary inbox providers. Not exhaustive — the long tail rotates
# weekly — but these are the ones that turn up in scraped data and form fills.
# Subdomains match too (``x.mailinator.com``).
DISPOSABLE_DOMAINS: frozenset[str] = frozenset({
    "10minutemail.com", "10minutemail.net", "20minutemail.com", "33mail.com",
    "anonaddy.me", "burnermail.io", "byom.de", "discard.email", "dispostable.com",
    "dropmail.me", "emailondeck.com", "emailtemp.org", "fakeinbox.com",
    "fakemail.net", "getairmail.com", "getnada.com", "guerrillamail.biz",
    "guerrillamail.com", "guerrillamail.de", "guerrillamail.info",
    "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com",
    "harakirimail.com", "inboxbear.com", "incognitomail.org", "jetable.org",
    "mail.tm", "mail7.io", "maildrop.cc", "mailcatch.com", "mailinator.com",
    "mailinator.net", "mailinator2.com", "mailnesia.com", "mailpoof.com",
    "mintemail.com", "moakt.com", "mohmal.com", "mytemp.email", "mytrashmail.com",
    "nada.email", "throwawaymail.com", "sharklasers.com", "spam4.me",
    "spambox.us", "spamgourmet.com", "temp-mail.io", "temp-mail.org",
    "tempail.com", "tempinbox.com", "tempmail.dev", "tempmail.net",
    "tempmailo.com", "tempmail.plus", "tempr.email", "trash-mail.com",
    "trashmail.com", "trashmail.de", "trashmail.net", "trbvm.com",
    "wegwerfmail.de", "yopmail.com", "yopmail.fr", "yopmail.net",
    "emailfake.com", "fexpost.com", "grr.la", "pokemail.net", "mailsac.com",
    "inboxkitten.com", "luxusmail.org", "tmail.ws", "tmpmail.org",
    "tmpmail.net", "minuteinbox.com", "emlhub.com", "linshiyouxiang.net",
})


class MxStatus(str, enum.Enum):
    ACCEPTS = "accepts"    # MX, or an A/AAAA the sender may fall back to
    NO_MAIL = "no_mail"    # NXDOMAIN, null MX, or no records at all
    UNKNOWN = "unknown"    # timeout, SERVFAIL, no reachable nameserver


@dataclass(frozen=True)
class Verdict:
    status: EmailVerification
    # A sentence for the tracker; None when deliverable.
    reason: str | None = None

    @property
    def sendable(self) -> bool:
        return self.status != EmailVerification.UNDELIVERABLE


DELIVERABLE = Verdict(EmailVerification.DELIVERABLE)


# ---------------------------------------------------------------------------
# Address-only checks
# ---------------------------------------------------------------------------


def domain_of(address: str) -> str:
    return address.rsplit("@", 1)[-1].strip().lower().rstrip(".")


def check_format(address: str | None) -> Verdict | None:
    """``None`` when the address is well-formed, else the failing verdict."""
    value = (address or "").strip()
    if not _BASIC_FORMAT.match(value):
        return Verdict(EmailVerification.UNDELIVERABLE, "Not a valid email address.")
    try:
        # Syntax only; the DNS half is ours, async and cached.
        validate_email(value, check_deliverability=False)
    except EmailNotValidError as exc:
        return Verdict(
            EmailVerification.UNDELIVERABLE, f"Not a valid email address: {exc}"[:255]
        )
    return None


def is_disposable(domain: str) -> bool:
    labels = domain.lower().rstrip(".").split(".")
    # The domain itself and every parent: ``a.b.mailinator.com`` → ``mailinator.com``.
    return any(".".join(labels[i:]) in DISPOSABLE_DOMAINS for i in range(len(labels) - 1))


def check_disposable(address: str) -> Verdict | None:
    if is_disposable(domain_of(address)):
        return Verdict(
            EmailVerification.UNDELIVERABLE,
            "Disposable / temporary email domain.",
        )
    return None


def check_bounced(db: Session, address: str, recruiter: Recruiter | None = None) -> Verdict | None:
    """A previous hard bounce — this row's, or anyone's mail to this exact address.

    Another user's bounce only counts when it was matched to a message we sent
    (``email_id`` set). A DSN is just an email in someone's inbox, so an
    unmatched one is something a user could write themselves, and it would
    otherwise let one account switch an address off for everyone.
    """
    if recruiter is not None and recruiter.delivery_state == DeliveryState.HARD_BOUNCED:
        return Verdict(
            EmailVerification.UNDELIVERABLE, "This address has hard-bounced before."
        )
    bounced = db.scalar(
        select(EmailBounce.id)
        .where(
            EmailBounce.address == address.strip().lower(),
            EmailBounce.kind == BounceKind.HARD,
            EmailBounce.email_id.is_not(None),
        )
        .limit(1)
    )
    if bounced is not None:
        return Verdict(
            EmailVerification.UNDELIVERABLE, "Mail to this address has hard-bounced before."
        )
    return None


# ---------------------------------------------------------------------------
# DNS
# ---------------------------------------------------------------------------

_cache: dict[str, tuple[MxStatus, float]] = {}
_cache_lock = threading.Lock()
# Bounds memory on a long-lived worker that has crawled a lot of domains.
_CACHE_MAX = 20_000


def clear_mx_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _cached(domain: str) -> MxStatus | None:
    with _cache_lock:
        hit = _cache.get(domain)
        if hit is None:
            return None
        if hit[1] <= time.monotonic():
            del _cache[domain]
            return None
        return hit[0]


def _store(domain: str, status: MxStatus) -> None:
    # An unknown is never cached: it says nothing about the domain, and the next
    # caller deserves a fresh try rather than an hour of a resolver's bad minute.
    if status == MxStatus.UNKNOWN:
        return
    ttl = (
        settings.email_mx_cache_ttl_seconds
        if status == MxStatus.ACCEPTS
        else settings.email_mx_negative_cache_ttl_seconds
    )
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()
        _cache[domain] = (status, time.monotonic() + ttl)


async def _has_address_record(resolver: dns.asyncresolver.Resolver, domain: str) -> bool:
    for rdtype in ("A", "AAAA"):
        try:
            await resolver.resolve(domain, rdtype)
            return True
        except dns.resolver.NoAnswer:
            continue
    return False


async def _lookup(domain: str) -> MxStatus:
    resolver = dns.asyncresolver.Resolver()
    resolver.lifetime = settings.email_mx_timeout_seconds
    try:
        answer = await resolver.resolve(domain, "MX")
        exchanges = [r.exchange for r in answer]
        # RFC 7505 null MX: one record pointing at the root — "this domain
        # sends but does not receive".
        if exchanges and all(e == dns.name.root for e in exchanges):
            return MxStatus.NO_MAIL
        return MxStatus.ACCEPTS
    except dns.resolver.NXDOMAIN:
        return MxStatus.NO_MAIL
    except dns.resolver.NoAnswer:
        # No MX: RFC 5321 §5.1 says deliver to the A/AAAA host instead.
        try:
            if await _has_address_record(resolver, domain):
                return MxStatus.ACCEPTS
            return MxStatus.NO_MAIL
        except dns.resolver.NXDOMAIN:
            return MxStatus.NO_MAIL
        except dns.exception.DNSException:
            return MxStatus.UNKNOWN
    except dns.exception.DNSException as exc:
        # Timeout, SERVFAIL, no nameservers: about our resolver as much as theirs.
        logger.info("MX lookup for %s inconclusive: %s", domain, type(exc).__name__)
        return MxStatus.UNKNOWN


async def mx_status(domain: str) -> MxStatus:
    """Whether *domain* accepts mail. Cached; never raises."""
    domain = domain.strip().lower().rstrip(".")
    if not settings.email_mx_check_enabled:
        return MxStatus.ACCEPTS
    hit = _cached(domain)
    if hit is not None:
        return hit
    try:
        status = await _lookup(domain)
    except Exception:  # noqa: BLE001 - a resolver bug must not stop the pipeline
        logger.exception("MX lookup for %s failed unexpectedly", domain)
        status = MxStatus.UNKNOWN
    _store(domain, status)
    return status


async def mx_statuses(domains: list[str]) -> dict[str, MxStatus]:
    """Several domains concurrently — what a discovery run over a crawl wants."""
    unique = sorted({d.strip().lower().rstrip(".") for d in domains})
    results = await asyncio.gather(*(mx_status(d) for d in unique))
    return dict(zip(unique, results, strict=True))


def prefetch_domains(addresses: list[str]) -> None:
    """Warm the MX cache for *addresses*' domains in one concurrent round."""
    domains = [domain_of(a) for a in addresses if "@" in (a or "")]
    if domains and settings.email_mx_check_enabled:
        _run(mx_statuses(domains))


def _run(coro):
    """Run *coro* from sync code — a Celery task, or a sync FastAPI handler's thread.

    ``asyncio.run`` refuses inside a running loop, which is where an ``async def``
    route would call this from; that case gets a short-lived thread of its own.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def _domain_verdict(address: str, status: MxStatus) -> Verdict | None:
    if status == MxStatus.NO_MAIL:
        return Verdict(
            EmailVerification.UNDELIVERABLE,
            f"The domain {domain_of(address)} does not accept email.",
        )
    if status == MxStatus.UNKNOWN:
        return Verdict(
            EmailVerification.UNKNOWN,
            "Couldn't confirm the domain accepts email (DNS lookup failed).",
        )
    return None


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def check_without_dns(
    db: Session, address: str, recruiter: Recruiter | None = None
) -> Verdict | None:
    """Checks 1-3: the ones that cost no network."""
    return (
        check_format(address)
        or check_disposable(address)
        or check_bounced(db, address, recruiter)
    )


def verify_address(db: Session, address: str, recruiter: Recruiter | None = None) -> Verdict:
    """All four checks. Sync; the DNS step runs on its own event loop."""
    failed = check_without_dns(db, address, recruiter)
    if failed is not None:
        return failed
    return _domain_verdict(address, _run(mx_status(domain_of(address)))) or DELIVERABLE


async def verify_address_async(
    db: Session, address: str, recruiter: Recruiter | None = None
) -> Verdict:
    """:func:`verify_address` for callers already on an event loop."""
    failed = check_without_dns(db, address, recruiter)
    if failed is not None:
        return failed
    return _domain_verdict(address, await mx_status(domain_of(address))) or DELIVERABLE


def _is_fresh(recruiter: Recruiter, now: datetime) -> bool:
    checked = recruiter.email_verified_at
    if checked is None or recruiter.email_verification in (
        EmailVerification.UNVERIFIED, EmailVerification.UNKNOWN,
    ):
        return False
    if checked.tzinfo is None:  # SQLite hands timestamps back naive
        checked = checked.replace(tzinfo=UTC)
    return now - checked < timedelta(days=settings.email_verification_ttl_days)


def ensure_verified(db: Session, recruiter: Recruiter, *, now: datetime | None = None) -> Verdict:
    """The recruiter's current verdict, re-checking and storing it when stale.

    The stored verdict is reused while fresh, so a campaign sweeping the same
    contact daily doesn't re-resolve its domain each time — except that a hard
    bounce since the last check always wins, because that is the one thing
    that can turn a fresh ``DELIVERABLE`` into a lie. The caller commits.
    """
    now = now or datetime.now(UTC)
    if recruiter.delivery_state == DeliveryState.HARD_BOUNCED or not _is_fresh(recruiter, now):
        verdict = verify_address(db, recruiter.email, recruiter)
        recruiter.email_verification = verdict.status
        recruiter.email_verification_reason = verdict.reason
        recruiter.email_verified_at = now
        if not verdict.sendable:
            logger.info(
                "Recipient %s marked undeliverable: %s", recruiter.id, verdict.reason,
            )
        return verdict
    if recruiter.email_verification == EmailVerification.UNDELIVERABLE:
        return Verdict(EmailVerification.UNDELIVERABLE, recruiter.email_verification_reason)
    return DELIVERABLE


def is_undeliverable(db: Session, recruiter: Recruiter | None) -> bool:
    """Shorthand for the gates: ``True`` means do not compose, do not send."""
    return recruiter is not None and not ensure_verified(db, recruiter).sendable


__all__ = [
    "DELIVERABLE",
    "DISPOSABLE_DOMAINS",
    "MxStatus",
    "Verdict",
    "check_bounced",
    "check_disposable",
    "check_format",
    "clear_mx_cache",
    "ensure_verified",
    "is_disposable",
    "is_undeliverable",
    "mx_status",
    "mx_statuses",
    "prefetch_domains",
    "verify_address",
    "verify_address_async",
]
