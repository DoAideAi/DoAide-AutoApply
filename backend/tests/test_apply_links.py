"""Apply-link extraction and ATS vendor detection — pure markup work, no network."""
from __future__ import annotations

import pytest

from app.models.form_apply import ATSPlatform
from app.services.apply_links import detect_vendor, extract_apply_target

TACHYON_URL = "https://www.tachyontech.com/jobs/ai-architect-2/"
OORWIN_URL = (
    "https://tachyonind.oorwin.ai/#/careers/index.html/job/"
    "d341d25fa1807ef0cea6a335b8b2c9948d6d1ddf"
)

# Trimmed from the real page: the "Apply Job" button opens an Elementor popup,
# the ATS URL is the text of a <p>, and a script holds a URL *template*.
TACHYON_HTML = f"""
<html><body>
<nav><a href="https://www.tachyontech.com/">Home</a>
<a href="https://www.tachyontech.com/careers/">Careers</a></nav>
<h1>AI Architect</h1>
<div class="apply-job-btn elementor-widget" id="apply-job-btn">
  <a class="elementor-button" target="_blank"
     href="#elementor-action%3Aaction%3Dpopup%3Aopen">
    <span class="elementor-button-text">Apply Job</span></a>
</div>
<div id="url-job-txt"><p class="elementor-heading-title">{OORWIN_URL}</p></div>
<script>
  const BTN_SEL = 'a[href*="tachyon.oorwin.ai/#/careers/other_domain/job/"]';
  function normalizeToUrl(v) {{
    return 'https://tachyon.oorwin.ai/#/careers/other_domain/job/' + v;
  }}
</script>
<a href="https://www.linkedin.com/sharing/share-offsite/?url={TACHYON_URL}">Share</a>
<a href="https://www.facebook.com/sharer.php?u={TACHYON_URL}">Share</a>
</body></html>
"""


class TestDetectVendor:
    @pytest.mark.parametrize(
        ("url", "key"),
        [
            (OORWIN_URL, "oorwin"),
            ("https://boards.greenhouse.io/acme/jobs/4012345", "greenhouse"),
            ("https://job-boards.greenhouse.io/acme/jobs/4012345", "greenhouse"),
            ("https://careers.acme.com/jobs?gh_jid=4012345", "greenhouse"),
            ("https://jobs.lever.co/acme/5f1c2d3e-aaaa-bbbb-cccc-1234567890ab", "lever"),
            ("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Pune/SRE_R123", "workday"),
            ("https://acme.bamboohr.com/careers/42", "bamboohr"),
            ("https://jobs.ashbyhq.com/acme/0b6f4c3e-1111-2222-3333-444455556666", "ashby"),
            ("https://jobs.smartrecruiters.com/Acme/743999912345678", "smartrecruiters"),
            ("https://apply.workable.com/acme/j/ABC123DEF4/", "workable"),
            ("https://acme.recruitee.com/o/backend-engineer", "recruitee"),
            ("https://acme.applytojob.com/apply/AbC123/Engineer", "jazzhr"),
            ("https://careers-acme.icims.com/jobs/1234/job", "icims"),
            ("https://acme.keka.com/careers/jobdetails/1234", "keka"),
            ("https://acme.zohorecruit.in/jobs/Careers/123/Engineer", "zoho"),
            ("https://www.linkedin.com/jobs/view/3812345678", "linkedin"),
            ("https://www.naukri.com/job-listings-backend-engineer-123", "naukri"),
        ],
    )
    def test_recognises_the_platform(self, url, key):
        vendor = detect_vendor(url)
        assert vendor is not None and vendor.key == key

    @pytest.mark.parametrize(
        "url",
        [
            None,
            "",
            "https://www.tachyontech.com/jobs/ai-architect-2/",
            # The vendor's own marketing site is not a tenant.
            "https://www.keka.com/pricing",
            "https://www.bamboohr.com/pricing",
            # A LinkedIn share button is not a LinkedIn job.
            "https://www.linkedin.com/sharing/share-offsite/?url=x",
            # Lookalike hosts must not match on a substring.
            "https://notlever.co.example.com/jobs/1",
        ],
    )
    def test_anything_else_is_not_a_vendor(self, url):
        assert detect_vendor(url) is None

    def test_vendors_with_adapters_carry_their_platform(self):
        assert detect_vendor("https://jobs.lever.co/acme/1").platform is ATSPlatform.LEVER
        assert detect_vendor("https://jobs.lever.co/acme/1").has_autofill is True
        assert detect_vendor(OORWIN_URL).has_autofill is False


class TestExtractApplyTarget:
    def test_finds_the_ats_url_printed_as_text_behind_a_popup_button(self):
        target = extract_apply_target(TACHYON_HTML, TACHYON_URL)
        assert target.apply_url == OORWIN_URL
        assert target.vendor.key == "oorwin"
        assert target.found_in == "text"

    def test_a_url_template_in_a_script_never_wins(self):
        target = extract_apply_target(TACHYON_HTML.replace(OORWIN_URL, ""), TACHYON_URL)
        assert target.apply_url is None

    def test_an_apply_anchor_on_a_known_ats(self):
        html = """<a href="/team">Team</a>
        <a class="btn" href="https://jobs.lever.co/acme/5f1c2d3e-aaaa/apply">
          Apply for this job</a>"""
        target = extract_apply_target(html, "https://acme.com/careers/backend")
        assert target.apply_url == "https://jobs.lever.co/acme/5f1c2d3e-aaaa/apply"
        assert target.vendor.key == "lever"

    def test_an_apply_anchor_on_an_unknown_domain(self):
        html = """<a href="/about">About us</a>
        <a href="https://hire.acme-careers.net/positions/8812/apply">Apply now</a>"""
        target = extract_apply_target(html, "https://acme.com/jobs/8812")
        assert target.apply_url == "https://hire.acme-careers.net/positions/8812/apply"
        assert target.vendor is None

    def test_an_embedded_iframe(self):
        html = (
            '<iframe src="https://boards.greenhouse.io/embed/job_app'
            '?for=acme&token=4012345"></iframe>'
        )
        target = extract_apply_target(html, "https://acme.com/careers?gh_jid=4012345")
        assert target.apply_url.startswith("https://boards.greenhouse.io/embed/job_app")
        assert target.found_in == "iframe"

    def test_a_relative_apply_link_resolves_against_the_page(self):
        html = '<a href="apply?job=991">Apply</a>'
        target = extract_apply_target(html, "https://careers.acme.com/jobs/991/")
        assert target.apply_url == "https://careers.acme.com/jobs/991/apply?job=991"

    def test_a_posting_already_on_an_ats_is_its_own_answer(self):
        url = "https://jobs.lever.co/acme/5f1c2d3e-aaaa-bbbb-cccc-1234567890ab"
        target = extract_apply_target("<h1>Engineer</h1>", url)
        # Lever keeps the form one path segment away from the posting.
        assert target.apply_url == f"{url}/apply"
        assert target.found_in == "page"

    def test_share_buttons_and_navigation_are_not_apply_links(self):
        html = """<a href="https://www.facebook.com/sharer.php?u=x">Apply via Facebook</a>
        <a href="https://twitter.com/intent/tweet?url=x">Share</a>
        <a href="https://acme.com/">Home</a>"""
        target = extract_apply_target(html, "https://acme.com/jobs/1")
        assert target.apply_url is None

    def test_an_apply_by_email_address(self):
        html = "<p>Interested? Send your CV to careers@acme.com with the role in the subject.</p>"
        target = extract_apply_target(html, "https://acme.com/jobs/1")
        assert target.apply_url is None
        assert target.apply_email == "careers@acme.com"

    def test_a_mailto_link(self):
        html = '<a href="mailto:jobs@acme.com?subject=Backend">Apply by email</a>'
        assert extract_apply_target(html, "https://acme.com/jobs/1").apply_email == "jobs@acme.com"

    def test_an_unrelated_address_is_not_an_apply_email(self):
        html = "<footer>Questions about our privacy policy: privacy@acme.com</footer>"
        assert extract_apply_target(html, "https://acme.com/jobs/1").apply_email is None

    def test_empty_markup(self):
        target = extract_apply_target("", "https://acme.com/jobs/1")
        assert target.apply_url is None and target.apply_email is None
