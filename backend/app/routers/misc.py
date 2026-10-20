"""Health check and CAN-SPAM unsubscribe endpoints."""
from __future__ import annotations

import logging
from html import escape

from fastapi import APIRouter, Depends, Form
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pii import mask_email
from app.core.rate_limit import ip_rate_limit
from app.services import health as health_service
from app.services import llm_router, opt_out
from app.services import unsubscribe as unsubscribe_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["misc"])

# Both routes below are unauthenticated by design, and both do real work per
# call — which is the combination that had no ceiling on it anywhere in this
# module.
#
# `/health` runs the checks it advertises: a `SELECT 1` round trip and a Redis
# connect, each with its own timeout. That is a database connection checked out
# of a pool deliberately sized to the request threadpool (see
# `test_connection_pool`), taken by an anonymous caller, on a route no session
# is needed to reach. Unmetered, a flat flood of `/health` starves every
# authenticated request of the pool it shares — a health endpoint that reports
# the outage it is causing.
#
# The limit is set well above any monitor: `scripts/verify_deploy.py` polls it
# a handful of times per deploy and the uptime check runs on tens of seconds,
# so two a second is orders of magnitude of headroom while still bounding the
# flood.
_health_limit = ip_rate_limit(120, 60, scope="health")

# The opt-out is the more delicate of the two, and the limit is deliberately
# loose because of it. A refused unsubscribe is worse than a served one: the
# route honours *unsigned* links on purpose (see `unsubscribe`), CAN-SPAM makes
# the mechanism's availability the obligation, and a provider that gets a
# non-2xx from a `List-Unsubscribe` URL scores it against the sending mailbox —
# the mailbox this product spends the rest of its effort protecting.
#
# What the ceiling is actually for is the other direction. `_opt_out` writes,
# the address is chosen by the caller, and the match is on address across
# *every* user's recruiter list — so with a list of addresses and no limit, one
# script opts out the whole database in the time it takes to loop. Thirty in
# five minutes is far more opt-outs than this deployment's send volume can
# generate and slow enough that the same script now takes weeks.
#
# Both GET and POST share the scope: RFC 8058 providers POST and humans click
# the link, and they mean the same thing, so metering them apart would make the
# ceiling a ceiling on neither.
_unsubscribe_limit = ip_rate_limit(30, 300, scope="unsubscribe")


@router.get("/health", dependencies=[Depends(_health_limit)])
def health(db: Session = Depends(get_db)) -> dict:
    """Whether the dependencies this deployment cannot work without are answering.

    ``status`` is ``ok`` only when every check in ``checks`` passed, and
    ``degraded`` otherwise, with the failing dependency named. Before this the
    field was a literal — see :mod:`app.services.health` for what that cost.

    **Why a degraded deployment still answers 200.** The verdict is in the
    body, not the status code, because the only consumer that acts on this is
    ``scripts/verify_deploy.py``, which fetches with ``curl -fsS`` — and ``-f``
    suppresses the body of a non-2xx response. Answering 503 would replace a
    report naming the broken dependency with an empty string, so the deploy
    check would still fail, and would no longer be able to say why. There is no
    load balancer in this topology whose rotation a 503 would change.

    ``mailboxes`` is reported on the same terms as the LLM fields below and for
    the same reason — see :func:`app.services.health.mailbox_grants`. It is here
    because a deployment whose grants have all expired sends nothing, receives
    nothing, and passes every check above; that is this product's most frequent
    total outage and the monitor watching for outages could not see it, the
    figures being behind ``/admin/ops``' admin session.

    The LLM fields are a different kind of claim and stay reported rather than
    judged. A tripped breaker is usually self-healing and resets on restart, so
    treating it as a failed deploy would make every deploy look like a fix.
    ``llm_model_errors`` and ``llm_auth_errors`` are the two an operator must
    fix by hand — a configured model id the upstream no longer recognises, and
    a key it will not accept. They are reported separately because they send
    the reader to different settings, and because both are the kind of fault
    the chain is designed to *absorb*: every caller falls back to its template,
    every task reports success, and the only symptom is a product that quietly
    behaves as though it had never been given AI at all. All of these are
    per-process, so this is the API's view and workers keep their own.

    Left out of ``quiet_paths``' logging on purpose: see
    :class:`app.core.logging.RequestContextMiddleware`.
    """
    checks = health_service.run_checks(db)
    return {
        "status": health_service.overall_status(checks),
        "checks": {c.name: c.as_dict() for c in checks},
        "mailboxes": health_service.mailbox_grants(db),
        "llm_providers": llm_router.configured_providers(),
        "llm_breakers_open": llm_router.breaker.snapshot(),
        "llm_model_errors": llm_router.model_errors(),
        "llm_auth_errors": llm_router.auth_errors(),
    }


def _record(request: unsubscribe_service.UnsubscribeRequest, contacts: int) -> None:
    """Write down that an opt-out happened, and whether the link was ours.

    `unsubscribe.verify` has always computed `signed` and nothing has ever read
    it, which made the signature buy nothing operationally: it was compared,
    stored on a dataclass, and dropped. The module's own docstring says the flag
    exists so "a flood of them is visible as the abuse it would be, rather than
    looking like a sudden collapse in message quality" — this is the line that
    makes that true.

    **Unsigned is a warning, and deliberately so.** It is either a link that
    predates the signature — real, and honoured, and getting rarer every week —
    or someone burning a contact they guessed the address of. Both are worth
    seeing, and neither is visible in the opt-out count alone: a sender watching
    unsubscribes climb cannot otherwise tell "our mail got worse" from "someone
    is walking our recipient list".

    Nothing here refuses anything. Refusing is what this endpoint must never do,
    and the reason the obvious defence — a rate limit — is the wrong tool today
    is written up in the RUNBOOK rather than attempted here.

    **The address is masked.** It used to be logged in full, on the reasoning
    that it is already echoed into the confirmation page this same request
    renders — but that page is shown to the person the address belongs to,
    which a log aggregator is not. This is the moment a third party asks not to
    be contacted, and writing their address into a store with a wider access
    list, a longer retention and no delete path is the wrong direction to move
    it in. What the line is actually for still works masked: two opt-outs from
    the same domain are still one bucket, two different mailboxes on it are
    still distinguishable, and the full address is in ``recruiters`` and on the
    request id if support needs to resolve it. See :mod:`app.core.pii`.
    """
    if not request.valid:
        # No address at all. Not a click a human made; not worth a line.
        return
    if request.signed:
        logger.info(
            "unsubscribe: %s opted out via a signed link (%d contact rows)",
            mask_email(request.address),
            contacts,
        )
        return
    logger.warning(
        "unsubscribe: %s opted out via an UNSIGNED link (%d contact rows) — "
        "a legacy link or a forgery; see RUNBOOK",
        mask_email(request.address),
        contacts,
    )


def _opt_out(db: Session, request: unsubscribe_service.UnsubscribeRequest) -> None:
    """Opt an address out everywhere.

    Deliberately idempotent and deliberately silent about what it found: the
    page says the same thing whether the address was on ten recruiter rows or
    none, because the alternative — "we had no record of you" — turns an
    unsubscribe endpoint into an oracle telling any caller whether a given
    address is in the database.

    The match is equality on the lowercased address, not ``ilike``. It was
    ``ilike`` — which reads as "equals, ignoring case" and is not: the address
    arrives from an unauthenticated query string, ``%`` is a wildcard, and
    ``/unsubscribe?email=%`` therefore opted out every contact of every user and
    cancelled every follow-up behind them. A signature would not have helped,
    because this endpoint honours unsigned links on purpose.
    """
    contacts = 0
    if request.valid:
        # The consent flag plus the work queued behind it — a sequence left
        # SCHEDULED reads on the tracker as mail still coming, and a batch
        # queued hours ahead reads the same way until each one comes due and is
        # written off one at a time. Shared with the `mailto:` route, which is
        # the other half of the `List-Unsubscribe` header this link comes from.
        contacts = opt_out.apply(db, request.address, reason="recipient unsubscribed")
        if contacts:
            db.commit()
    _record(request, contacts)


# The page is one card in three states. `confirm` asks, `unsubscribed` confirms
# and offers the way back, `resubscribed` confirms that and offers the way out
# again. Each is a POST form with no `action` attribute, so it posts back to the
# exact URL — query string, signature and all — that the email carried.
_STATES = {
    "confirm": (
        "Unsubscribe from these emails?",
        "You'll stop receiving job-application emails sent to {email} "
        "through AutoApply.",
        ("unsubscribe", "Unsubscribe", True),
    ),
    "unsubscribed": (
        "You've been unsubscribed",
        "You will no longer receive job-application emails at {email}.",
        ("resubscribe", "Re-subscribe", False),
    ),
    "resubscribed": (
        "You're subscribed again",
        "Job seekers using AutoApply may contact you at {email} again. "
        "Follow-ups that were cancelled stay cancelled.",
        ("unsubscribe", "Unsubscribe", True),
    ),
    "refused": (
        "This link can't re-subscribe you",
        "Re-subscribing needs the original link from an email. You can still "
        "unsubscribe {email} below.",
        ("unsubscribe", "Unsubscribe", True),
    ),
}

_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>{title}</title>
<style>
:root{{color-scheme:light dark;--bg:#f9fafb;--card:#fff;--ink:#111827;--muted:#6b7280;
--line:#e5e7eb;--accent:#0d9488;--accent-hover:#0f766e;--ghost:#f3f4f6}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0a0a0b;--card:#141417;--ink:#e5e7eb;
--muted:#9ca3af;--line:#2a2a2d;--accent:#14b8a6;--accent-hover:#2dd4bf;--ghost:#1a1a1d}}}}
*{{box-sizing:border-box}}
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
padding:24px 16px;background:var(--bg);color:var(--ink);
font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Helvetica,Arial,sans-serif}}
main{{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);
border-radius:14px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
h1{{margin:0 0 10px;font-size:21px;line-height:1.3}}
p{{margin:0 0 22px;color:var(--muted)}}
strong{{color:var(--ink);word-break:break-all}}
button{{width:100%;border:0;border-radius:9px;padding:11px 16px;font:inherit;
font-weight:600;cursor:pointer;transition:background .15s}}
.primary{{background:var(--accent);color:#fff}}.primary:hover{{background:var(--accent-hover)}}
.ghost{{background:var(--ghost);color:var(--ink);border:1px solid var(--line)}}
.ghost:hover{{border-color:var(--accent)}}
button:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
</style></head>
<body><main data-state="{state}">
<h1>{title}</h1>
<p>{body}</p>
{form}
</main></body></html>"""


def _page(state: str, address: str, *, signed: bool = True) -> str:
    """The opt-out card in *state*, for *address* (escaped).

    An unsigned link gets no Re-subscribe button: the POST would refuse it.
    """
    title, body, (action, label, primary) = _STATES[state]
    # Escaped: the address is echoed straight from the query string, and an
    # unauthenticated public endpoint that reflects its input into HTML is a
    # stored-nowhere-but-still-real XSS against anyone handed the link.
    shown = f"<strong>{escape(address)}</strong>" if address else "this address"
    form = (
        '<form method="post">'
        f'<input type="hidden" name="action" value="{action}">'
        f'<button type="submit" class="{"primary" if primary else "ghost"}">'
        f"{label}</button></form>"
        if address and (signed or action != "resubscribe")
        else ""
    )
    return _PAGE.format(
        title=title, body=body.format(email=shown), form=form, state=state
    )


@router.get(
    "/unsubscribe",
    response_class=HTMLResponse,
    dependencies=[Depends(_unsubscribe_limit)],
)
def unsubscribe(
    email: str, sig: str | None = None, db: Session = Depends(get_db)
) -> str:
    """The page an opt-out link opens: the address and an Unsubscribe button.

    A GET changes nothing. It used to opt the address out on arrival, which
    also meant every link scanner and mail-security prefetcher that fetched the
    URL unsubscribed the recruiter before a human saw the message. Opting out
    is the button's POST — or the provider's own one-click POST.

    The current state is shown only to a signed link: it proves the holder was
    sent our mail, while to an unsigned caller "already unsubscribed" would
    answer whether an address is in the database.

    ``sig`` is the HMAC :mod:`app.services.unsubscribe` puts on the link. It is
    never *required* to opt out: links already sitting in mailboxes predate it,
    and refusing a genuine opt-out to punish a missing parameter is the one
    outcome worse than honouring a forged one.
    """
    request = unsubscribe_service.verify(email, sig)
    if request.signed and opt_out.is_opted_out(db, request.address):
        return _page("unsubscribed", request.address)
    return _page("confirm", request.address)


@router.post(
    "/unsubscribe",
    response_class=HTMLResponse,
    dependencies=[Depends(_unsubscribe_limit)],
)
def unsubscribe_post(
    email: str,
    sig: str | None = None,
    # RFC 8058 says the provider POSTs `List-Unsubscribe=One-Click` as a form
    # body. It is declared so the body parses rather than 422ing, and Optional
    # so a hand-rolled POST without it still works.
    List_Unsubscribe: str | None = Form(default=None, alias="List-Unsubscribe"),
    action: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """Opt out — or, from the page's own form, opt back in.

    Anything but an explicit ``action=resubscribe`` is an opt-out. That covers
    the page's Unsubscribe button and the one-click opt-out (RFC 8058) every
    unsolicited send advertises: Gmail's and Yahoo's native "Unsubscribe"
    buttons POST here with no ``action``, and must keep opting out at once.

    Re-subscribing requires a valid signature. The asymmetry is the one
    :func:`app.services.unsubscribe.verify` describes, run backwards: a forged
    opt-out costs a contact the user can re-add, a forged opt-in mails somebody
    who asked not to be mailed.
    """
    request = unsubscribe_service.verify(email, sig)
    if (action or "").strip().lower() == "resubscribe":
        if not request.signed:
            return HTMLResponse(_page("refused", request.address), status_code=403)
        restored = opt_out.restore(db, request.address)
        if restored:
            db.commit()
        logger.info(
            "unsubscribe: %s re-subscribed via a signed link (%d contact rows)",
            mask_email(request.address),
            restored,
        )
        return HTMLResponse(_page("resubscribed", request.address))
    _opt_out(db, request)
    return HTMLResponse(
        _page("unsubscribed", request.address, signed=request.signed)
    )
