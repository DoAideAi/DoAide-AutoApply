"""The outreach footer's postal-address line.

Cold outreach goes out from the job seeker's own Gmail, so the footer must not
sign it with an address that is not theirs — least of all the placeholder the
configuration ships with.
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.services import gmail_service

URL = "https://job.doaide.com/api/v1/unsubscribe?email=r%40acme.com&sig=abc"


def test_placeholder_address_is_never_printed(monkeypatch):
    monkeypatch.setattr(
        settings, "compliance_physical_address", gmail_service.PLACEHOLDER_POSTAL_ADDRESS
    )
    footer = gmail_service.canspam_footer(URL)
    assert "Example St" not in footer
    assert footer.endswith(f"unsubscribe here: {URL}")


@pytest.mark.parametrize("value", ["", "   ", None])
def test_unset_address_leaves_the_line_out(monkeypatch, value):
    monkeypatch.setattr(settings, "compliance_physical_address", value)
    assert gmail_service.footer_postal_address() == ""
    assert gmail_service.canspam_footer(URL).endswith(URL)


def test_a_real_address_is_printed_once_on_its_own_line(monkeypatch):
    monkeypatch.setattr(
        settings, "compliance_physical_address", "  12 MG Road,\n Bengaluru 560001 "
    )
    footer = gmail_service.canspam_footer(URL)
    assert footer.splitlines()[-1] == "12 MG Road, Bengaluru 560001"
    assert footer.count("12 MG Road") == 1


def test_the_footer_keeps_its_opt_out_and_ascii_separator(monkeypatch):
    monkeypatch.setattr(settings, "compliance_physical_address", "")
    footer = gmail_service.canspam_footer(URL)
    assert footer.startswith("--\n")
    assert footer.isascii()
    assert footer.count(URL) == 1
