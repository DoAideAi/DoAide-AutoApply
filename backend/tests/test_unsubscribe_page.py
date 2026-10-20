"""The opt-out page: GET shows a button, POST opts out, a signed form opts back in.

Recruiters reach ``/api/v1/unsubscribe?email=…&sig=…`` from the footer of a
cold email. A GET must change nothing (link scanners fetch it); the page's
button and the provider's RFC 8058 one-click POST both opt out; and only a
signed link may re-subscribe.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.recruiter import Recruiter
from app.services import unsubscribe as unsubscribe_service

URL = "/api/v1/unsubscribe"
ADDRESS = "sam@acme.com"


@pytest.fixture()
def contact(db_session, current_user):
    row = Recruiter(user_id=current_user.id, email=ADDRESS, name="Sam")
    db_session.add(row)
    db_session.commit()
    return row


def _signed(address=ADDRESS):
    return {"email": address, "sig": unsubscribe_service.sign(address)}


def _state(html: str) -> str:
    return html.split('data-state="', 1)[1].split('"', 1)[0]


def _opted_out(db_session) -> bool:
    db_session.expire_all()
    return db_session.scalar(
        select(Recruiter.opted_out).where(Recruiter.email == ADDRESS)
    )


class TestVisitingTheLink:
    def test_shows_the_address_and_an_unsubscribe_button(self, client, contact, db_session):
        resp = client.get(URL, params=_signed())
        assert resp.status_code == 200
        assert _state(resp.text) == "confirm"
        assert f"<strong>{ADDRESS}</strong>" in resp.text
        assert 'name="action" value="unsubscribe"' in resp.text
        assert ">Unsubscribe</button>" in resp.text

    def test_a_visit_changes_nothing(self, client, contact, db_session):
        client.get(URL, params=_signed())
        assert _opted_out(db_session) is False

    def test_a_signed_link_shows_the_current_state(self, client, contact, db_session):
        contact.opted_out = True
        db_session.commit()
        resp = client.get(URL, params=_signed())
        assert _state(resp.text) == "unsubscribed"
        assert ">Re-subscribe</button>" in resp.text

    def test_an_unsigned_link_never_reveals_state(self, client, contact, db_session):
        contact.opted_out = True
        db_session.commit()
        resp = client.get(URL, params={"email": ADDRESS})
        assert _state(resp.text) == "confirm"

    def test_the_address_is_escaped(self, client):
        resp = client.get(URL, params={"email": "<script>x</script>@a.com"})
        assert "<script>x" not in resp.text
        assert "&lt;script&gt;" in resp.text

    def test_is_not_indexed_or_leaked_by_referrer(self, client):
        html = client.get(URL, params=_signed()).text
        assert 'name="robots" content="noindex,nofollow"' in html
        assert 'name="referrer" content="no-referrer"' in html


class TestTheButtons:
    def test_unsubscribe_then_resubscribe_then_unsubscribe(self, client, contact, db_session):
        params = _signed()

        resp = client.post(URL, params=params, data={"action": "unsubscribe"})
        assert resp.status_code == 200
        assert _state(resp.text) == "unsubscribed"
        assert 'value="resubscribe"' in resp.text
        assert _opted_out(db_session) is True

        resp = client.post(URL, params=params, data={"action": "resubscribe"})
        assert resp.status_code == 200
        assert _state(resp.text) == "resubscribed"
        assert 'value="unsubscribe"' in resp.text
        assert _opted_out(db_session) is False

        resp = client.post(URL, params=params, data={"action": "unsubscribe"})
        assert _state(resp.text) == "unsubscribed"
        assert _opted_out(db_session) is True

    def test_provider_one_click_still_opts_out_at_once(self, client, contact, db_session):
        resp = client.post(
            URL, params=_signed(), data={"List-Unsubscribe": "One-Click"}
        )
        assert resp.status_code == 200
        assert _opted_out(db_session) is True

    def test_an_unsigned_link_still_opts_out(self, client, contact, db_session):
        resp = client.post(URL, params={"email": ADDRESS}, data={"action": "unsubscribe"})
        assert _state(resp.text) == "unsubscribed"
        assert _opted_out(db_session) is True
        # ...but is offered no way back it could not use.
        assert 'value="resubscribe"' not in resp.text

    @pytest.mark.parametrize("sig", [None, "0" * 32])
    def test_resubscribe_needs_a_valid_signature(self, client, contact, db_session, sig):
        contact.opted_out = True
        db_session.commit()
        params = {"email": ADDRESS, **({"sig": sig} if sig else {})}
        resp = client.post(URL, params=params, data={"action": "resubscribe"})
        assert resp.status_code == 403
        assert _state(resp.text) == "refused"
        assert _opted_out(db_session) is True

    def test_resubscribe_matches_case_insensitively(self, client, contact, db_session):
        contact.opted_out = True
        db_session.commit()
        resp = client.post(
            URL, params=_signed("SAM@Acme.com"), data={"action": "resubscribe"}
        )
        assert resp.status_code == 200
        assert _opted_out(db_session) is False

    def test_unknown_address_gets_the_same_answer(self, client, db_session):
        resp = client.post(
            URL, params=_signed("nobody@nowhere.com"), data={"action": "unsubscribe"}
        )
        assert resp.status_code == 200
        assert _state(resp.text) == "unsubscribed"
