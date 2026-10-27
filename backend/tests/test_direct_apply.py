"""Direct Apply — import a job from any URL, prepare it, track it.

The page fetch and Gemini are stubbed: the tests cover what is done with a page
and a completion, not the network.
"""
from __future__ import annotations

import json

import pytest

from app.models.cover_letter import CoverLetter
from app.models.form_apply import FormApplyProfile
from app.models.job import JobPosting, JobStatus
from app.models.user import User
from app.services import direct_apply_service, gemini_client
from app.services.jd_parser import FetchedPage, JobFetchError

PAGE_URL = "https://www.tachyontech.com/jobs/ai-architect-2/"
OORWIN_URL = (
    "https://tachyonind.oorwin.ai/#/careers/index.html/job/"
    "d341d25fa1807ef0cea6a335b8b2c9948d6d1ddf"
)
JOB_TEXT = """AI Architect
Tachyon Technologies — Hyderabad, TS

We are hiring an AI Architect to design agentic platforms for enterprise customers.

Requirements:
- 7+ years of software engineering experience
- Strong Python and FastAPI
- Experience with AWS and Kubernetes
- Experience designing LLM-based systems

Responsibilities:
- Own the architecture of our agentic platform
- Work with customers to scope AI pilots
"""
PAGE_HTML = f"""<html><head><title>AI Architect - Tachyon</title></head><body>
<main><pre>{JOB_TEXT}</pre></main>
<div class="apply-job-btn"><a href="#elementor-action%3Apopup">Apply Job</a></div>
<p>{OORWIN_URL}</p>
</body></html>"""

LETTER = (
    "I have spent the last several years building backend services in Python and "
    "FastAPI at Acme, and designing an agentic platform for enterprise customers "
    "is the work I most want to do next. I would welcome the chance to talk about "
    "how my experience running services on AWS could help your team."
)


@pytest.fixture()
def page(monkeypatch):
    calls: list[str] = []

    def fake_fetch(url, **kwargs):
        calls.append(url)
        return FetchedPage(
            text=JOB_TEXT, title="AI Architect - Tachyon", html=PAGE_HTML, final_url=url
        )

    monkeypatch.setattr(direct_apply_service, "fetch_job_page", fake_fetch)
    return calls


@pytest.fixture()
def gemini(monkeypatch):
    """Gemini answers: a letter for the letter prompt, nothing for the parser."""
    prompts: list[str] = []

    def fake_generate(system, prompt, **kwargs):
        prompts.append(system)
        if "cover letter" in system.lower():
            return json.dumps({"body": LETTER})
        return "{}"

    monkeypatch.setattr(gemini_client, "generate", fake_generate)
    return prompts


def _import(client, **payload):
    return client.post("/api/v1/direct-apply/import", json={"url": PAGE_URL, **payload})


class TestImport:
    def test_imports_the_job_and_finds_the_ats_link(self, auth_client, resume, page, gemini):
        res = _import(auth_client)
        assert res.status_code == 201, res.text
        body = res.json()

        job = body["job"]
        assert job["title"]
        assert job["url"] == PAGE_URL
        assert job["apply_url"] == OORWIN_URL
        assert job["ats_key"] == "oorwin" and job["ats_label"] == "Oorwin"
        assert job["status"] == "SAVED"
        assert job["fit_score"] is not None
        assert body["created"] is True

        assert "python" in [s.lower() for s in body["requirements"]["required_skills"]]
        assert body["fit"]["overall"] == job["fit_score"]

    def test_the_cover_letter_comes_from_gemini(self, auth_client, resume, page, gemini):
        letter = _import(auth_client).json()["cover_letter"]
        assert letter["body"] == LETTER
        assert letter["generated_with"] == "llm"
        assert LETTER in letter["full_text"]
        assert any("cover letter" in p.lower() for p in gemini)

    def test_without_gemini_the_letter_still_arrives(
        self, auth_client, resume, page, monkeypatch
    ):
        def unavailable(*args, **kwargs):
            raise gemini_client.GeminiUnavailable("no key")

        monkeypatch.setattr(gemini_client, "generate", unavailable)
        letter = _import(auth_client).json()["cover_letter"]
        # No provider at all in tests: the deterministic, grounded draft.
        assert letter["body"]
        assert letter["generated_with"] != "llm"

    def test_prepares_the_form_data(self, auth_client, resume, page, gemini, db_session):
        db_session.add(
            FormApplyProfile(
                user_id=resume.user_id,
                phone="+91 98765 43210",
                work_authorized=True,
                requires_sponsorship=False,
                notice_period_days=30,
                custom_answers={"Why Tachyon?": "Agentic platforms are my focus."},
            )
        )
        db_session.commit()

        form = _import(auth_client).json()["form"]
        assert form["full_name"] == "Jordan Candidate"
        assert form["email"] == "candidate@example.com"
        assert form["phone"] == "+91 98765 43210"
        assert form["resume_filename"] == "jordan.pdf"
        answers = {a["label"]: a["value"] for a in form["answers"]}
        assert answers["Authorized to work"] == "Yes"
        assert answers["Requires visa sponsorship"] == "No"
        assert answers["Notice period"] == "30 days"
        assert answers["Why Tachyon?"] == "Agentic platforms are my focus."
        assert "Phone" not in form["missing"]
        assert "LinkedIn URL" in form["missing"]

    def test_never_guesses_legally_significant_answers(self, auth_client, resume, page, gemini):
        form = _import(auth_client).json()["form"]
        labels = {a["label"] for a in form["answers"]}
        assert "Authorized to work" not in labels
        assert "Requires visa sponsorship" not in labels

    def test_importing_twice_updates_the_same_job(
        self, auth_client, resume, page, gemini, db_session
    ):
        first = _import(auth_client).json()
        second = _import(auth_client).json()
        assert second["job"]["id"] == first["job"]["id"]
        assert second["created"] is False
        assert db_session.query(JobPosting).count() == 1
        assert db_session.query(CoverLetter).count() == 1

    def test_a_js_page_can_be_imported_with_a_pasted_description(
        self, auth_client, resume, gemini, monkeypatch
    ):
        def blocked(url, **kwargs):
            raise JobFetchError("That page didn't return readable job text")

        monkeypatch.setattr(direct_apply_service, "fetch_job_page", blocked)
        res = auth_client.post(
            "/api/v1/direct-apply/import", json={"url": OORWIN_URL, "description": JOB_TEXT}
        )
        assert res.status_code == 201, res.text
        job = res.json()["job"]
        # The pasted URL is itself the ATS, so it is where to apply.
        assert job["ats_key"] == "oorwin"
        assert job["apply_url"] == OORWIN_URL

    def test_an_unreadable_page_without_a_description_says_why(
        self, auth_client, resume, monkeypatch
    ):
        def blocked(url, **kwargs):
            raise JobFetchError("That page didn't return readable job text")

        monkeypatch.setattr(direct_apply_service, "fetch_job_page", blocked)
        res = _import(auth_client)
        assert res.status_code == 422
        assert "readable job text" in res.json()["detail"]

    def test_needs_a_resume(self, auth_client, page, gemini, db_session):
        res = _import(auth_client)
        assert res.status_code == 409
        assert db_session.query(JobPosting).count() == 0

    @pytest.mark.parametrize("url", ["not a url", "ftp://example.com/job", "javascript:alert(1)"])
    def test_refuses_what_is_not_a_web_url(self, auth_client, resume, url):
        res = auth_client.post("/api/v1/direct-apply/import", json={"url": url})
        assert res.status_code == 422

    def test_a_feed_job_pasted_again_is_saved_not_duplicated(
        self, auth_client, resume, page, gemini, db_session
    ):
        first = _import(auth_client).json()["job"]
        posting = db_session.get(JobPosting, first["id"])
        posting.status = JobStatus.DISMISSED
        db_session.commit()

        again = _import(auth_client).json()["job"]
        assert again["id"] == first["id"]
        assert again["status"] == "SAVED"


class TestTracking:
    def test_lists_imported_jobs_only(self, auth_client, resume, page, gemini, db_session):
        _import(auth_client)
        db_session.add(
            JobPosting(
                user_id=resume.user_id,
                fingerprint="feed-row",
                title="Feed job",
                source="remoteok",
            )
        )
        db_session.commit()

        rows = auth_client.get("/api/v1/direct-apply").json()
        assert [r["apply_url"] for r in rows] == [OORWIN_URL]

    def test_mark_applied_and_take_it_back(self, auth_client, resume, page, gemini):
        job_id = _import(auth_client).json()["job"]["id"]

        applied = auth_client.post(f"/api/v1/direct-apply/{job_id}/applied").json()
        assert applied["status"] == "APPLIED"
        assert applied["applied_at"] is not None

        again = auth_client.post(f"/api/v1/direct-apply/{job_id}/applied").json()
        assert again["applied_at"] == applied["applied_at"]

        undone = auth_client.delete(f"/api/v1/direct-apply/{job_id}/applied").json()
        assert undone["status"] == "SAVED"
        assert undone["applied_at"] is None

    def test_detail_reads_back_what_import_prepared(self, auth_client, resume, page, gemini):
        imported = _import(auth_client).json()
        detail = auth_client.get(f"/api/v1/direct-apply/{imported['job']['id']}").json()
        assert detail["job"]["apply_url"] == OORWIN_URL
        assert detail["cover_letter"]["body"] == LETTER
        assert detail["fit"]["overall"] == imported["fit"]["overall"]
        assert detail["form"]["email"] == "candidate@example.com"
        assert detail["requirements"]["required_skills"]

    def test_rewrite_keeps_an_edited_letter_unless_forced(
        self, auth_client, resume, page, gemini
    ):
        imported = _import(auth_client).json()
        job_id, letter_id = imported["job"]["id"], imported["cover_letter"]["id"]
        auth_client.patch(f"/api/v1/cover-letter/{letter_id}", json={"body": "My own words."})

        kept = auth_client.post(f"/api/v1/direct-apply/{job_id}/cover-letter", json={}).json()
        assert kept["body"] == "My own words."

        forced = auth_client.post(
            f"/api/v1/direct-apply/{job_id}/cover-letter", json={"force": True}
        ).json()
        assert forced["body"] == LETTER

    def test_another_users_job_is_not_found(self, auth_client, resume, db_session):
        stranger = User(email="stranger@example.com", hashed_password="x")
        db_session.add(stranger)
        db_session.flush()
        other = JobPosting(user_id=stranger.id, fingerprint="x", source="direct")
        db_session.add(other)
        db_session.commit()
        assert auth_client.get(f"/api/v1/direct-apply/{other.id}").status_code == 404
        assert auth_client.post(f"/api/v1/direct-apply/{other.id}/applied").status_code == 404


class TestGeminiFirst:
    def test_falls_back_to_the_provider_chain(self, monkeypatch):
        def unavailable(*args, **kwargs):
            raise gemini_client.GeminiUnavailable("no key")

        monkeypatch.setattr(gemini_client, "generate", unavailable)
        monkeypatch.setattr(
            direct_apply_service, "chat_completion", lambda messages, **kw: "from the chain"
        )
        out = direct_apply_service.gemini_first(
            [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
        )
        assert out == "from the chain"

    def test_sends_system_and_user_separately(self, monkeypatch):
        seen = {}

        def fake(system, prompt, **kwargs):
            seen.update(system=system, prompt=prompt, **kwargs)
            return "ok"

        monkeypatch.setattr(gemini_client, "generate", fake)
        direct_apply_service.gemini_first(
            [{"role": "system", "content": "rules"}, {"role": "user", "content": "job"}],
            max_tokens=900,
        )
        assert seen["system"] == "rules" and seen["prompt"] == "job"
        assert seen["max_output_tokens"] >= 4096


class TestGeminiThinking:
    """``thinking_level`` is a latency knob; a model that rejects it still answers."""

    class _Resp:
        def __init__(self, status, text=""):
            self.status_code = status
            self._text = text

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": self._text}]}}]}

    def test_asks_for_low_thinking_and_retries_without_it_on_400(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        sent: list[dict] = []

        def fake_post(url, headers, json, timeout):
            sent.append(json["generationConfig"])
            if "thinkingConfig" in json["generationConfig"]:
                return self._Resp(400)
            return self._Resp(200, "answer")

        monkeypatch.setattr(gemini_client.httpx, "post", fake_post)
        assert gemini_client.generate("s", "p", thinking_level="low") == "answer"
        assert sent[0]["thinkingConfig"] == {"thinkingLevel": "low"}
        assert "thinkingConfig" not in sent[1]

    def test_no_thinking_setting_unless_asked(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        sent: list[dict] = []

        def fake_post(url, headers, json, timeout):
            sent.append(json["generationConfig"])
            return self._Resp(200, "answer")

        monkeypatch.setattr(gemini_client.httpx, "post", fake_post)
        gemini_client.generate("s", "p")
        assert "thinkingConfig" not in sent[0]
