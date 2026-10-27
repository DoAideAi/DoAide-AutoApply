"""LinkedIn sign-in against the page LinkedIn actually serves.

The sign-in page became a React app: no <form>, generated ids, a hidden copy of
each field rendered before the visible one, and "Sign in" sitting beside "Sign
in with Apple". The old code typed into ``#username`` / ``#password``, which no
longer exist, so every Easy Apply run failed at login. These tests drive
:func:`ensure_login` over a fake of that page.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import linkedin_service as svc
from app.services.browser_runner import TransientBrowserError

FEED = "https://www.linkedin.com/feed/"
LOGIN_PATH = "https://www.linkedin.com/login/"

# What a visibility query matches on today's page.
NEW_PAGE = {
    "input[autocomplete~='username']:visible",
    "input[type='email']:visible",
    "input[type='password']:visible",
    "role:Sign in",
}
CLASSIC_PAGE = {
    "#username:visible",
    "#password:visible",
    "button[type='submit']:visible",
}


class _Locator:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector

    def count(self):
        return 1 if self.page.is_visible(self.selector) else 0

    @property
    def first(self):
        return self

    def fill(self, value, timeout=None):
        self.page.typed[self.selector] = value

    def click(self, timeout=None):
        self.page.clicked.append(self.selector)
        self.page.submit()

    def press(self, key, timeout=None):
        self.page.pressed.append((self.selector, key))
        self.page.submit()


class FakeLinkedIn:
    """Signed out until the form is submitted; then whatever *outcome* says."""

    def __init__(self, visible, *, signed_in=False, outcome="ok"):
        self.signed_in = signed_in
        self.login_visible = set(visible)
        self.outcome = outcome
        self.url = "about:blank"
        self.body = ""
        self.typed: dict[str, str] = {}
        self.clicked: list[str] = []
        self.pressed: list[tuple[str, str]] = []
        self.visited: list[str] = []

    def goto(self, url, **kwargs):
        self.visited.append(url)
        if "/feed" in url and not self.signed_in:
            self.url = LOGIN_PATH  # LinkedIn's own redirect
        else:
            self.url = url
        return SimpleNamespace(status=200, url=self.url)

    def is_visible(self, selector):
        on_login = "/login" in self.url and not self.signed_in
        return on_login and selector in self.login_visible

    def locator(self, selector):
        return _Locator(self, selector)

    def get_by_role(self, role, *, name, exact=False):
        assert role == "button" and exact
        return _Locator(self, f"role:{name}")

    def click(self, selector, timeout=None):
        raise RuntimeError(f"no {selector}")  # cookie banners: none here

    def inner_text(self, selector):
        return self.body

    def wait_for_timeout(self, ms):
        pass

    def submit(self):
        if self.outcome == "ok":
            self.signed_in = True
            self.url = FEED
        elif self.outcome == "challenge":
            self.url = "https://www.linkedin.com/checkpoint/challenge/abc"
        elif self.outcome == "bad_password":
            self.body = "That's not the right password."


ACCOUNT = SimpleNamespace(email="candidate@example.com")


@pytest.fixture(autouse=True)
def _no_status_check(monkeypatch):
    monkeypatch.setattr(svc, "goto", lambda page, url, **kw: page.goto(url))


def test_signs_in_on_todays_page():
    page = FakeLinkedIn(NEW_PAGE)
    svc.ensure_login(page, ACCOUNT, "pw")
    assert page.typed == {
        "input[autocomplete~='username']:visible": "candidate@example.com",
        "input[type='password']:visible": "pw",
    }
    # The button named exactly "Sign in" — never "Sign in with Apple".
    assert page.clicked == ["role:Sign in"]
    assert page.signed_in


def test_still_signs_in_on_the_classic_page():
    page = FakeLinkedIn(CLASSIC_PAGE)
    svc.ensure_login(page, ACCOUNT, "pw")
    assert page.typed["#username:visible"] == "candidate@example.com"
    assert page.typed["#password:visible"] == "pw"
    assert page.clicked == ["button[type='submit']:visible"]


def test_presses_enter_when_no_sign_in_button_is_found():
    page = FakeLinkedIn(NEW_PAGE - {"role:Sign in"})
    svc.ensure_login(page, ACCOUNT, "pw")
    assert page.pressed == [("input[type='password']:visible", "Enter")]
    assert page.signed_in


def test_asks_for_english():
    page = FakeLinkedIn(NEW_PAGE)
    svc.ensure_login(page, ACCOUNT, "pw")
    assert any("_l=en_US" in url for url in page.visited)


def test_a_live_session_types_nothing():
    page = FakeLinkedIn(NEW_PAGE, signed_in=True)
    svc.ensure_login(page, ACCOUNT, "pw")
    assert page.typed == {} and page.visited == [FEED]


def test_a_redirect_to_login_counts_as_signed_out_even_with_no_field_visible():
    page = FakeLinkedIn(set())
    with pytest.raises(TransientBrowserError, match="no email/password field"):
        svc.ensure_login(page, ACCOUNT, "pw")


def test_a_security_check_stops_the_run():
    page = FakeLinkedIn(NEW_PAGE, outcome="challenge")
    with pytest.raises(svc.LinkedInChallenge):
        svc.ensure_login(page, ACCOUNT, "pw")


def test_a_rejected_password_stops_the_run():
    page = FakeLinkedIn(NEW_PAGE, outcome="bad_password")
    with pytest.raises(svc.LinkedInCredentialsRejected):
        svc.ensure_login(page, ACCOUNT, "pw")
