"""Where a job page actually takes your application — and which ATS is behind it.

Direct Apply starts from a URL the candidate pasted: usually the company's own
careers page, not the form. The form lives somewhere else — an ATS on another
domain — and the page's job is to send you there. How it does that varies more
than you would hope:

* an ordinary ``<a href>`` with "Apply" on it (the easy case);
* a Greenhouse or Ashby form iframed into the page;
* a button that opens a *popup* in JavaScript, with the real ATS URL printed as
  plain text elsewhere on the page for a script to pick up. Tachyon's careers
  site does exactly this: its "Apply Job" link is ``#elementor-action…`` and
  the Oorwin URL is the text of a ``<p>``;
* an email address and "send your CV to…".

So this module does not look for *the* apply button. It collects every URL the
page mentions — hrefs, iframes, form actions, ``data-*`` attributes, bare URLs
in the text, JSON-LD — scores each one on the evidence, and keeps the best. A
known ATS domain is the strongest evidence there is; "apply" in the link text
is the next. URLs inside ``<script>`` count for less, because scripts hold
templates (``…/careers/job/' + id``) as often as they hold links.

Vendor detection is a separate, wider table than
:mod:`app.services.ats_platform`. That module's :class:`ATSPlatform` is a
database enum naming the platforms the browser agent has adapters for; this one
names every ATS worth *recognising*, so the candidate is told "Oorwin" or
"BambooHR" rather than "career page". Each vendor carries its ``ATSPlatform``
where one exists, so the two never disagree about the platforms both know.

Pure string and markup work: no network calls, so it is cheap and unit-tested
against saved markup.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup

from app.models.form_apply import ATSPlatform
from app.services import ats_platform

KIND_ATS = "ats"
KIND_BOARD = "board"


@dataclass(frozen=True)
class Vendor:
    """One applicant-tracking system (or job board), as the UI names it.

    ``hosts`` are registrable domains matched against the URL's host and its
    parents; an entry starting with ``.`` matches subdomains only, for vendors
    whose bare domain is a marketing site (``keka.com``) and whose tenants are
    ``acme.keka.com``. ``paths``, when given, must also appear in the URL.
    """

    key: str
    label: str
    hosts: tuple[str, ...]
    paths: tuple[str, ...] = ()
    kind: str = KIND_ATS
    platform: ATSPlatform | None = None

    @property
    def has_autofill(self) -> bool:
        """True when the browser agent has a purpose-built adapter for it."""
        return self.platform is not None and ats_platform.has_adapter(self.platform)


# Ordered most-specific first; the first match wins.
VENDORS: tuple[Vendor, ...] = (
    Vendor(
        "linkedin", "LinkedIn", ("linkedin.com",), ("/jobs",), KIND_BOARD, ATSPlatform.LINKEDIN
    ),
    Vendor("indeed", "Indeed", ("indeed.com", "indeed.co.in", "indeed.co.uk"), (), KIND_BOARD),
    Vendor("naukri", "Naukri", ("naukri.com",), (), KIND_BOARD),
    Vendor("wellfound", "Wellfound", ("wellfound.com", "angel.co"), (), KIND_BOARD),
    Vendor(
        "greenhouse",
        "Greenhouse",
        ("greenhouse.io", "grnh.se"),
        (),
        KIND_ATS,
        ATSPlatform.GREENHOUSE,
    ),
    Vendor("lever", "Lever", ("lever.co",), (), KIND_ATS, ATSPlatform.LEVER),
    Vendor("ashby", "Ashby", ("ashbyhq.com",), (), KIND_ATS, ATSPlatform.ASHBY),
    Vendor(
        "workday",
        "Workday",
        ("myworkdayjobs.com", "myworkdaysite.com"),
        (),
        KIND_ATS,
        ATSPlatform.WORKDAY,
    ),
    Vendor("icims", "iCIMS", ("icims.com",), (), KIND_ATS, ATSPlatform.ICIMS),
    Vendor("oorwin", "Oorwin", ("oorwin.ai", "oorwin.com")),
    Vendor("bamboohr", "BambooHR", (".bamboohr.com",)),
    Vendor("smartrecruiters", "SmartRecruiters", ("smartrecruiters.com",)),
    Vendor("workable", "Workable", ("workable.com",)),
    Vendor("recruitee", "Recruitee", (".recruitee.com",)),
    Vendor("jazzhr", "JazzHR", ("applytojob.com",)),
    Vendor("jobvite", "Jobvite", ("jobvite.com",)),
    Vendor("taleo", "Oracle Taleo", ("taleo.net",)),
    Vendor("oracle", "Oracle Recruiting", ("oraclecloud.com",), ("/hcmui/candidateexperience",)),
    Vendor("successfactors", "SAP SuccessFactors", ("successfactors.com", "successfactors.eu")),
    Vendor("zoho", "Zoho Recruit", ("zohorecruit.com", "zohorecruit.in", "zohorecruit.eu")),
    Vendor("freshteam", "Freshteam", (".freshteam.com",)),
    Vendor("keka", "Keka", (".keka.com",)),
    Vendor("darwinbox", "Darwinbox", ("darwinbox.in", "darwinbox.com")),
    Vendor("teamtailor", "Teamtailor", (".teamtailor.com",)),
    Vendor("personio", "Personio", ("jobs.personio.de", "jobs.personio.com")),
    Vendor("breezy", "Breezy HR", (".breezy.hr",)),
    Vendor("rippling", "Rippling", ("ats.rippling.com",)),
    Vendor("dover", "Dover", ("app.dover.com",)),
    Vendor("pinpoint", "Pinpoint", (".pinpointhq.com",)),
)

_BY_KEY = {vendor.key: vendor for vendor in VENDORS}

# Hosts whose links on a job page are sharing buttons and profile links, never
# the application — unless the path says it is a job (LinkedIn is both).
_SOCIAL_HOSTS = (
    "facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "youtube.com",
    "whatsapp.com",
    "wa.me",
    "t.me",
    "pinterest.com",
    "reddit.com",
    "linkedin.com",
    "glassdoor.com",
    "google.com",
    "goo.gl",
    "apple.com",
)

_APPLY_TEXT = re.compile(
    r"\b(apply|easy apply|submit (?:your )?(?:application|cv|resume)|i'?m interested)\b",
    re.I,
)
_URL_IN_TEXT = re.compile(r"https?://[^\s\"'<>`\\]+", re.I)
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# A path or fragment that names one posting rather than a listing: a run of
# digits, a long hex id, or a UUID.
_JOB_ID = re.compile(r"(?:\d{3,}|[0-9a-f]{12,}|[0-9a-f]{8}-[0-9a-f]{4}-)", re.I)
# The listing roots a template or a nav link points at.
_LISTING_ROOT = re.compile(r"/(?:jobs?|careers?|openings|positions|vacancies)/?$", re.I)
_EMAIL_HINT = re.compile(
    r"\b(apply|resume|cv|careers?|jobs?|hiring|recruit\w*|application)\b", re.I
)
_EMAIL_LOCAL_HINT = re.compile(
    r"^(careers?|jobs?|hr|hiring|recruit\w*|talent|people|apply)\b", re.I
)
_TRAILING_PUNCT = ".,;:!?)]}'\""

# Evidence weights. A known ATS domain dominates; everything else is a nudge.
_SCORE_VENDOR_ATS = 100
_SCORE_VENDOR_BOARD = 40
_SCORE_APPLY_TEXT = 60
_SCORE_APPLY_IN_URL = 25
_SCORE_JOB_ID = 15
_PENALTY_LISTING_ROOT = -60
_SOURCE_WEIGHT = {
    "page": 120,
    "iframe": 30,
    "form": 30,
    "link": 10,
    "attr": 10,
    "jsonld": 0,
    "text": 5,
    "script": -40,
}
# Below this, the best candidate is a guess and the caller is better off
# telling the candidate there was no separate application link.
MIN_SCORE = 60


@dataclass
class Candidate:
    url: str
    source: str
    score: int
    vendor: Vendor | None = None


@dataclass
class ApplyTarget:
    """The best answer to "where do I apply?" for one job page."""

    apply_url: str | None = None
    vendor: Vendor | None = None
    # How the link was found — "page" when the posting URL *is* the ATS.
    found_in: str | None = None
    apply_email: str | None = None
    candidates: list[Candidate] = field(default_factory=list)


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def _host_matches(host: str, domain: str) -> bool:
    if domain.startswith("."):
        # Tenants only: ``www.keka.com`` is the vendor's marketing site.
        return host.endswith(domain) and host != "www" + domain
    return host == domain or host.endswith("." + domain)


def _vendor_by_host(url: str) -> Vendor | None:
    host = _host(url)
    if not host:
        return None
    lowered = url.lower()
    for vendor in VENDORS:
        if any(_host_matches(host, d) for d in vendor.hosts) and (
            not vendor.paths or any(p in lowered for p in vendor.paths)
        ):
            return vendor
    return None


def detect_vendor(url: str | None) -> Vendor | None:
    """The ATS or job board behind *url*, or ``None`` for anything else."""
    if not url:
        return None
    vendor = _vendor_by_host(url)
    if vendor is not None:
        return vendor
    # Greenhouse's embed puts its own job id on the company's URL.
    if "gh_jid" in parse_qs(urlparse(url).query):
        return _BY_KEY["greenhouse"]
    return None


def vendor_by_key(key: str | None) -> Vendor | None:
    return _BY_KEY.get(key or "")


def _clean(url: str) -> str:
    url = url.strip()
    while url and url[-1] in _TRAILING_PUNCT:
        url = url[:-1]
    return url


def _is_social(url: str) -> bool:
    host = _host(url)
    if not any(_host_matches(host, d) for d in _SOCIAL_HOSTS):
        return False
    # A LinkedIn *job* is a real apply target; a share button or company page
    # is not.
    return detect_vendor(url) is None


def _score(url: str, source: str, *, text: str = "") -> Candidate | None:
    if not url.lower().startswith(("http://", "https://")) or _is_social(url):
        return None
    vendor = detect_vendor(url)
    score = _SOURCE_WEIGHT.get(source, 0)
    if vendor is not None:
        score += _SCORE_VENDOR_ATS if vendor.kind == KIND_ATS else _SCORE_VENDOR_BOARD
    if text and _APPLY_TEXT.search(text):
        score += _SCORE_APPLY_TEXT
    parsed = urlparse(url)
    tail = f"{parsed.path}?{parsed.query}#{parsed.fragment}".lower()
    if "apply" in tail:
        score += _SCORE_APPLY_IN_URL
    if _JOB_ID.search(tail):
        score += _SCORE_JOB_ID
    if _LISTING_ROOT.search(parsed.fragment or parsed.path):
        score += _PENALTY_LISTING_ROOT
    return Candidate(url=url, source=source, score=score, vendor=vendor)


def _element_text(tag) -> str:
    """What a reader (or a screen reader) would call this control."""
    bits = [tag.get_text(" ", strip=True)]
    for attr in ("aria-label", "title", "value", "id"):
        value = tag.get(attr)
        if isinstance(value, str):
            bits.append(value)
    classes = tag.get("class")
    if classes:
        bits.append(" ".join(classes))
    # The control is often a wrapper whose class names say what it is
    # ("apply-job-btn") while the link inside carries the href.
    parent = tag.parent
    if parent is not None and parent.get("class"):
        bits.append(" ".join(parent.get("class")))
    return " ".join(b for b in bits if b).replace("-", " ").replace("_", " ")


def _jsonld_urls(soup: BeautifulSoup) -> list[str]:
    urls: list[str] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            kind = node.get("@type")
            kinds = kind if isinstance(kind, list) else [kind]
            if "JobPosting" in kinds:
                for key in ("url", "sameAs"):
                    value = node.get(key)
                    if isinstance(value, str):
                        urls.append(value)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            walk(json.loads(script.string or ""))
        except (ValueError, TypeError):
            continue
    return urls


def _apply_email(soup: BeautifulSoup, text: str) -> str | None:
    """An address the page asks applications to be sent to, if any."""
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"].strip()
        if href.lower().startswith("mailto:"):
            address = href[7:].split("?", 1)[0].strip()
            if _EMAIL.fullmatch(address):
                return address
    for match in _EMAIL.finditer(text):
        address = match.group(0).rstrip(".")
        window = text[max(0, match.start() - 120) : match.end() + 40]
        if _EMAIL_LOCAL_HINT.match(address) or _EMAIL_HINT.search(window):
            return address
    return None


def extract_apply_target(html: str | None, page_url: str) -> ApplyTarget:
    """Find the application link (and any apply-by-email address) on a job page.

    *page_url* is the URL the page was served from — after redirects — so that
    relative links resolve, and so that a posting already on an ATS is its own
    answer.
    """
    candidates: dict[str, Candidate] = {}

    def offer(raw: str | None, source: str, *, text: str = "") -> None:
        if not raw or not isinstance(raw, str):
            return
        raw = raw.strip()
        if not raw or raw.startswith(("#", "javascript:", "mailto:", "tel:")):
            return
        url = _clean(urljoin(page_url, raw))
        # A link back to the page we are on, minus its hash routing, is
        # navigation — unless the hash is where an SPA keeps the form.
        same_page = url.split("#", 1)[0] == page_url.split("#", 1)[0]
        if same_page and source != "page" and "apply" not in url.lower():
            return
        candidate = _score(url, source, text=text)
        if candidate is None:
            return
        best = candidates.get(url)
        if best is None or candidate.score > best.score:
            candidates[url] = candidate

    # Only a page *served by* the ATS is its own answer. A company page carrying
    # Greenhouse's ``gh_jid`` merely embeds the form, and the embed is better.
    page_vendor = _vendor_by_host(page_url)
    if page_vendor is not None:
        target_url = page_url
        if page_vendor.platform is not None:
            target_url = ats_platform.apply_url(page_url, page_vendor.platform)
        offer(target_url, "page")

    soup = BeautifulSoup(html or "", "html.parser")

    for anchor in soup.find_all("a", href=True):
        offer(anchor["href"], "link", text=_element_text(anchor))
    for tag in soup.find_all(["button", "a", "div", "span"]):
        for attr in ("data-href", "data-url", "data-link", "data-apply-url"):
            offer(tag.get(attr), "attr", text=_element_text(tag))
        onclick = tag.get("onclick")
        if isinstance(onclick, str):
            for match in _URL_IN_TEXT.finditer(onclick):
                offer(match.group(0), "attr", text=_element_text(tag))
    for frame in soup.find_all("iframe", src=True):
        offer(frame["src"], "iframe")
    for form in soup.find_all("form", action=True):
        offer(form["action"], "form", text=_element_text(form))
    for url in _jsonld_urls(soup):
        offer(url, "jsonld")

    scripts = soup.find_all(["script", "style", "noscript"])
    script_text = "\n".join(s.get_text(" ") for s in scripts)
    for tag in scripts:
        tag.extract()
    page_text = soup.get_text(" ")
    for match in _URL_IN_TEXT.finditer(page_text):
        offer(match.group(0), "text")
    for match in _URL_IN_TEXT.finditer(script_text):
        offer(match.group(0), "script")

    ranked = sorted(candidates.values(), key=lambda c: c.score, reverse=True)
    target = ApplyTarget(candidates=ranked, apply_email=_apply_email(soup, page_text))
    if ranked and ranked[0].score >= MIN_SCORE:
        best = ranked[0]
        target.apply_url = best.url
        target.vendor = best.vendor
        target.found_in = best.source
    return target


__all__ = [
    "KIND_ATS",
    "KIND_BOARD",
    "MIN_SCORE",
    "VENDORS",
    "ApplyTarget",
    "Candidate",
    "Vendor",
    "detect_vendor",
    "extract_apply_target",
    "vendor_by_key",
]
