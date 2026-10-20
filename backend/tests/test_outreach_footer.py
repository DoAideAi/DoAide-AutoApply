"""The outreach footer: one opt-out, signed by the sender, nothing of DoAide's.

Cold outreach goes out from the job seeker's own Gmail, so the footer must name
them — not the operator's address, and least of all the placeholder the
configuration ships with — and must appear exactly once per part.
"""

from __future__ import annotations

import re

import pytest

from app.core.config import settings
from app.services import gmail_service

URL = "https://job.doaide.com/api/v1/unsubscribe?email=r%40acme.com&sig=abc"


def test_signed_by_the_sending_mailboxs_owner():
    footer = gmail_service.canspam_footer(URL, "Jordan Candidate")
    assert footer.splitlines()[-1] == "Jordan Candidate"
    assert footer.count(URL) == 1


@pytest.mark.parametrize(
    "address",
    ["123 Example St, Suite 100, San Francisco, CA 94105", "DoAide, Bengaluru"],
)
def test_never_the_deployments_address(monkeypatch, address):
    monkeypatch.setattr(settings, "compliance_physical_address", address)
    footer = gmail_service.canspam_footer(URL, "Jordan Candidate")
    assert address not in footer
    assert "doaide" not in footer.lower().replace(URL.lower(), "")


@pytest.mark.parametrize("name", [None, "", "   "])
def test_no_name_leaves_the_identity_line_out(name):
    assert gmail_service.canspam_footer(URL, name).endswith(f"unsubscribe here: {URL}")


def test_identity_is_flattened_to_one_line():
    footer = gmail_service.canspam_footer(URL, "  Jordan\n  Candidate ")
    assert footer.splitlines()[-1] == "Jordan Candidate"


def test_ascii_separator_and_the_only_link_is_the_opt_out():
    footer = gmail_service.canspam_footer(URL, "Jordan Candidate")
    assert footer.startswith("--\n")
    assert footer.isascii()
    assert re.findall(r"https?://\S+", footer) == [URL]


class TestWithoutFooter:
    def test_strips_a_footer_already_in_the_body(self):
        body = "Hi Sam,\n\nKeen to talk.\n\n" + gmail_service.canspam_footer(URL, "Jordan")
        assert gmail_service.without_footer(body) == "Hi Sam,\n\nKeen to talk."

    def test_strips_the_old_em_dash_form(self):
        body = (
            "Hi Sam.\n\n—\nYou are receiving this because your company's "
            "careers page lists this address.\nSomewhere"
        )
        assert gmail_service.without_footer(body) == "Hi Sam."

    def test_leaves_quoted_text_and_ordinary_signatures_alone(self):
        body = "Thanks!\n\n--\nJordan\n\n> --\n> You are receiving this because x"
        assert gmail_service.without_footer(body) == body

    def test_is_idempotent(self):
        body = "Hi.\n\n" + gmail_service.canspam_footer(URL, "Jordan")
        once = gmail_service.without_footer(body)
        assert gmail_service.without_footer(once) == once


class TestOneFooterPerPart:
    """A body that already carries a footer still goes out with exactly one."""

    def _parts(self, monkeypatch, body):
        captured = {}

        class _Send:
            def execute(self):
                return {"id": "m1", "threadId": "t1"}

        class _Messages:
            def send(self, userId, body):  # noqa: N803 - Gmail's own kwarg
                captured["raw"] = body["raw"]
                return _Send()

        class _Users:
            def messages(self):
                return _Messages()

        class _Service:
            def users(self):
                return _Users()

        monkeypatch.setattr(gmail_service, "_service", lambda account: _Service())
        monkeypatch.setattr(gmail_service, "_sent_message_id", lambda *a: None)

        class _Account:
            email = "jordan@gmail.com"
            display_name = "Jordan Candidate"

        gmail_service.send_email(
            account=_Account(),
            to="sam@acme.com",
            subject="Backend role",
            body_text=body,
            unsubscribe_url=URL,
        )
        import base64
        from email import message_from_bytes

        msg = message_from_bytes(base64.urlsafe_b64decode(captured["raw"]))
        return msg, msg.get_payload(decode=True).decode()

    def test_text_part_has_one_footer(self, monkeypatch):
        stale = gmail_service.canspam_footer(URL, "Jordan Candidate")
        msg, text = self._parts(monkeypatch, f"Hi Sam,\n\nKeen to talk.\n\n{stale}")
        assert text.count("You are receiving this because") == 1
        assert text.count(URL) == 1
        assert msg.get_content_type() == "text/plain"
        assert msg["List-Unsubscribe"] == f"<{URL}>"
        assert msg["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
