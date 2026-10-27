# Feature: Multi-site job search and auto-apply

Status: **proposal** — nothing here is implemented yet.
Product: AutoApply ([job.doaide.com](https://job.doaide.com))
Last updated: 2026-10-27

---

## 1. Overview

Today AutoApply finds jobs, scores them against the candidate's resumes, and
applies by **email to a recruiter** (outreach) or by **driving an employer's ATS
form** (Greenhouse, Lever, Ashby, iCIMS, Workday) plus **LinkedIn Easy Apply**.
What it cannot do is treat the big job boards as places to apply: a candidate
who finds a role on Naukri or Indeed still has to go there, sign in, and apply
by hand.

This feature adds:

1. **One search across job boards.** A single query returns deduplicated
   results from LinkedIn, Indeed, Naukri and Glassdoor (Phase 1 sites), ranked
   by the existing fit scorer.
2. **Apply from the results.** Clicking *Apply* checks whether the candidate has
   a usable account on that site, signs in with the stored session, and fills
   the application. If the job redirects to an employer ATS, the existing
   adapters take over.
3. **An account manager.** It tracks, per user and per site, whether there is a
   connected account, how it signs in, whether the session is still valid, and
   how much of today's apply budget is left.
4. **A dashboard of what needs the candidate.** Pending email/phone
   verifications, sign-in challenges, incomplete site profiles, failed
   applications, and the success rate per site.

### Guiding constraints (inherited, not new)

The codebase already settled several questions that this feature must not
reopen. They are restated because the rest of the design depends on them:

- **No direct scraping of LinkedIn or Indeed for discovery.** See
  `backend/app/services/job_search_service.py`: discovery goes through Google
  Jobs via SerpApi and public job-board APIs. LinkedIn's guest listings stay
  behind `LINKEDIN_JOB_SOURCE_ENABLED` (off by default). Proxycurl's July 2025
  shutdown is why.
- **A challenge stops the run.** A CAPTCHA, a 2FA prompt or an "unusual
  activity" screen ends the attempt as `NEEDS_INPUT` and becomes a pending
  action for the candidate. Nothing in this feature solves, outsources or
  evades a challenge (`linkedin_service.py` sets this rule; every new site
  follows it).
- **Nothing is submitted without consent.** "Fill, then stop" is the default
  (`submit_requested=False`). Submitting needs either a per-application
  confirmation or an explicit, per-site auto-submit opt-in that the candidate
  can revoke.
- **Automation of the boards is opt-in per deployment.** It follows the
  `LINKEDIN_EASY_APPLY` pattern: every site's auto-apply sits behind its own
  setting and is off by default. Turning one on is a deliberate decision made
  with the ToS risk in view (§6).

---

## 2. Target job sites (Phase 1)

| | LinkedIn | Indeed | Naukri | Glassdoor |
|---|---|---|---|---|
| **Primary market** | Global | Global (US/UK/IN) | India | US/UK |
| **Sign-in options** | Email + password; Google; Apple | Email + one-time code (passwordless by default); Google; Apple | Email/mobile + password; mobile OTP; Google | Email + password; Google; Apple *(confirm: Glassdoor sign-in is increasingly shared with Indeed)* |
| **Planned auth method** | Stored session; password fallback (exists today) | Google SSO session, else email-OTP session | Email + password session; Google SSO session in Phase 3 | Google SSO session, else email + password session |
| **Apply flow types** | Easy Apply (multi-step modal); external redirect | Indeed Apply (multi-step, with screener questions); external redirect | One-click apply with the Naukri profile; recruiter questionnaire; external redirect | Easy Apply, often Indeed-powered; external redirect |
| **Form complexity** | Medium: 1–5 steps, screeners, resume picker | Medium–high: screeners, assessments, resume upload or Indeed resume | Low for one-click, high if the profile is incomplete (profile completeness gates apply) | Medium; much of it is the Indeed flow |
| **Anti-bot posture** | Very high: device fingerprinting, behavioural velocity limits, account restriction | High: Cloudflare/bot management, CAPTCHA on sign-in and apply | Medium–high: OTP on new devices, CAPTCHA on repeated actions | High: Cloudflare, shared Indeed defences |
| **Account creation needs** | Email verification; often phone | Email OTP; sometimes phone | Mobile OTP is effectively mandatory; email verification | Email verification |
| **Discovery source** | SerpApi Google Jobs (existing) | SerpApi Google Jobs (existing) | SerpApi Google Jobs (India), to be validated; see §3.1 | SerpApi Google Jobs (existing) |
| **Existing code** | `linkedin_service.py`, `linkedin_accounts`, Easy Apply adapter | none | none | none |

Treat the table as a starting point, not a spec. Sign-in options and flows on
these sites change often. Phase 2 starts with a one-week spike per site that
records the current flows (screenshots plus `data-*` selectors) as fixtures.

### What "auto-create an account" can and cannot mean

The brief asks for accounts to be created automatically when the candidate has
none. That cannot be fully automated, for reasons that are about how these
sites work and not about effort:

- **Every site verifies new accounts out-of-band:** an email link or code, and
  for Naukri (often LinkedIn too) an SMS OTP to the candidate's phone. Those
  codes go to the candidate, not to us.
- **Sign-up is the most heavily bot-protected page on every one of these
  sites.** A CAPTCHA on sign-up is the norm, and by the rule above we stop at
  it.
- **All four sites' terms of service forbid creating accounts by automated
  means.** An account flagged at creation is restricted before it has applied
  anywhere.

So "auto-create" becomes **assisted sign-up**:

1. We pre-fill whatever the sign-up form takes (name, email, location, current
   title, resume) from the AutoApply profile.
2. The candidate finishes the steps only they can do (verification code, OTP,
   CAPTCHA, accepting the terms) in a session we hand them (§3.3).
3. Once they're signed in, we capture the session and mark the account
   `connected`.

On the dashboard, every step that is waiting on them shows up as a pending
action (§4).

### Google SSO

"Sign in with Google" can't be automated either. Google blocks sign-in from
automated browsers, and doing it would mean holding the candidate's Google
password, which we will never do. What works is the same hand-off:

1. The candidate does the Google sign-in themselves in an assisted session.
2. We keep the resulting **site** session (the job board's own cookies).
3. Google credentials never touch our servers.

When that site session expires, the candidate has to sign in again, which
becomes a pending action. This is the main reason Google SSO is Phase 3: its
sessions can't be refreshed without the candidate, so it costs them more effort
than a stored password does.

---

## 3. Architecture

```
                 ┌──────────────────────────── frontend (React) ───────────────────────────┐
                 │  Search page   Results + Apply   Accounts page   Dashboard (pending)   │
                 └─────┬───────────────┬────────────────┬──────────────────┬───────────────┘
                       │ REST          │                │                  │
┌──────────────────────▼───────────────▼────────────────▼──────────────────▼──────────────┐
│ FastAPI                                                                                  │
│  routers/job_search.py   routers/site_accounts.py   routers/pending_actions.py           │
│        │                        │                          ▲                             │
│  services/job_search_service ◄──┼── (extend: per-site      │                             │
│        │  + job_dedup + fit_scorer  result rows)           │                             │
│        ▼                        ▼                          │                             │
│  services/apply_router ──► services/site_accounts ──► services/pending_actions ──► notifications
│        │   (decides path)       (session, budget,           (open/resolve, dedupe)       │
│        ▼                         credential vault)                                       │
│  Celery: form_apply_tasks ──► form_apply_service ──► site adapters (new) / ats_adapters  │
│                                      │                                                   │
│                                      ▼                                                   │
│                               browser_runner (Playwright, Form vocabulary, screenshots)  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Job search aggregator

**Extend `job_search_service.py`; don't build a parallel one.** It already has
the provider abstraction (`RawJob`), normalisation, cross-board dedup
(`job_dedup.py`), deterministic scoring plus Scout re-rank, and company
research. New work:

- **Per-source result rows.** Today a deduped `job_postings` row keeps its
  source links in a list. The new `job_search_results` table (§5) records each
  hit separately: which site, which search run, its rank, and its *apply
  capability*. Without that, "Apply on Naukri" vs "Apply on Indeed" can't be a
  choice in the UI.
- **Apply capability per result**, worked out when the result is stored:
  - `site_native`: the board's own apply flow (Easy Apply, Indeed Apply, Naukri
    apply)
  - `external_ats`: the board redirects to an employer ATS, detected with
    `ats_platform.detect`
  - `external_unknown`
  - `email`: a recruiter address is known, so the existing outreach path can
    take it
- **Naukri coverage.** The first spike measures how much of Naukri's inventory
  SerpApi's Google Jobs `gl=in` results contain. If coverage is poor, the
  fallback is a licensed feed or partner API. Scraping Naukri is not the
  fallback; the same legal reasoning as LinkedIn and Indeed applies.
- **Synchronous search UX.** The current scans run on a beat schedule. An
  interactive search instead runs providers concurrently with a 10 s budget and
  returns partial results, labelled by source, rather than waiting on the
  slowest. Results are cached per `(normalised query, location, page)` for
  15 minutes to keep SerpApi spend bounded.

### 3.2 Form-filling engine

**Playwright, not Selenium.** `browser_runner.py` is already Playwright, with
lazy import, per-step screenshots stamped with URL and SHA-256 (the basis of
`submission_proof.py` receipts), retries, and the `Form` vocabulary that makes
adapters testable without a browser. A second engine would double the
maintenance and add nothing.

New work:

- **Site adapters** in `services/site_adapters/{linkedin,indeed,naukri,glassdoor}.py`,
  following the `ats_adapters.py` shape: fill what the resume knows, answer
  what it doesn't (`form_answers.py`), then stop or submit. The LinkedIn Easy
  Apply flow moves here from `linkedin_service.py` unchanged.
- **Hand-off to the ATS adapters.** When a board redirects to Workday,
  Greenhouse and so on, the run continues with the existing ATS adapter, and
  the attempt records both legs.
- **Legally significant answers.** Work authorisation, sponsorship, notice
  period and salary come only from `form_apply_profiles`; Scout never invents
  them. A screener question with no grounded answer ends the run as
  `NEEDS_INPUT` with the question attached, and that becomes a pending action
  rather than a guess.
- **Naukri profile completeness.** Naukri gates applying on its own profile
  being complete. Profile sync, a pre-apply step, diffs the AutoApply profile
  against the Naukri profile and fills the gaps, or raises an
  `incomplete_profile` pending action that lists the fields it couldn't fill.
- **Pacing.** A per-site minimum gap and a rolling-24h ceiling, generalising
  `linkedin_easy_apply_daily_limit`. Starting values: LinkedIn 25/day, Indeed
  20, Naukri 30, Glassdoor 20, each with a jittered 90–240 s gap. These are
  conservative guesses; tune them from restriction data, never upwards past
  the point an account gets flagged.

### 3.3 Account manager service

`services/site_accounts.py`, backed by `job_site_accounts` (§5). It generalises
`linkedin_accounts`, which migrates into it.

- **Sessions first, passwords last.** The steady state is stored session state
  (Playwright `storage_state`), Fernet-encrypted with the existing `crypto.py`
  key. A password is stored only where the site has no other durable sign-in
  (LinkedIn and Naukri email/password), only if the candidate opts in, and it
  is decrypted only inside the worker that is about to type it, the same as
  LinkedIn today. Never in logs, never in an API response.
- **Account states:**
  - `not_connected`
  - `signup_in_progress`
  - `verification_pending`
  - `connected`
  - `challenge_required`
  - `session_expired`
  - `invalid_credentials`
  - `restricted`
  - `disabled`

  Each transition into a state the candidate has to act on opens a pending
  action.
- **Assisted session (the hand-off).** For sign-up, Google SSO and challenge
  recovery, the candidate needs to drive a real browser that we can capture a
  session from. Two options, to decide in Phase 2:
  - **(a) Browser extension.** The candidate signs in in their own Chrome; a
    small extension exports that site's cookies to us for that domain only.
    This is the most robust option, because it's a real residential browser,
    and the cheapest. It is also a meaningful permission to ask for, and it has
    to go through Chrome Web Store review.
  - **(b) Remote browser.** A remote headed Chromium streamed to the page (CDP
    screencast or noVNC). No install, but it runs from datacenter IPs, which
    these sites challenge more often, and it costs more per session.

  Recommendation: start with **(a)** and keep **(b)** for candidates who won't
  install an extension.
- **Health checks.** A daily beat task opens each `connected` session headless
  and checks it's still signed in. It does nothing else, so it isn't counted
  against the apply budget. Sessions that fail move to `session_expired`
  before an application trips over them.
- **Disconnect** deletes the session, the password and the row's secrets
  immediately. Account deletion (`account_deletion.py`) and export
  (`account_export.py`) cover the new table, and the export never includes
  secrets.

### 3.4 Dashboard alert system

- **`pending_actions`** (§5) is the to-do list: each row is something only the
  candidate can resolve, and it has a lifecycle (`open → resolved | dismissed |
  expired`).
- **`notifications`** (existing) is how the candidate hears about a new pending
  action. Each new action emits a notification whose `dedupe_key` is
  state-scoped (e.g. `pending_action:naukri:verification:{account_id}`), so an
  hourly sweep can't repeat it. The weekly digest summarises open actions.
- **Dashboard widgets** (existing `routers/dashboard.py`):
  - open actions grouped by type, each with one primary button that deep-links
    to the fix
  - per-site account health
  - failed applications in the last 7 days, with reasons
  - success rate per site (submitted with confirmation ÷ attempted) and
    response rate (an outreach-style reply, or a status change from the site's
    own application tracker, where readable)

---

## 4. User flow

```
Search ──► Aggregated results ──► Apply ──► Account check ──┬─► connected ──► fill ──► review/submit ──► receipt
                                                            ├─► none ──► assisted sign-up ──► (pending: verify) ──► resume apply
                                                            ├─► expired/challenge ──► (pending: sign in) ──► resume apply
                                                            └─► external ATS ──► existing ATS adapter
```

1. **Search.** The candidate enters a query and location, or uses their saved
   search. Their autopilot targeting pre-fills the filters (remote,
   experience, posted-within, sites).
2. **Aggregated results.** One list, deduplicated: one card per role with a row
   of source badges (LinkedIn · Indeed · Naukri). Each card shows:
   - the fit score and Scout's one-line reason (existing)
   - ghost-job risk (existing `ghost_job.py`)
   - per source, how applying would work: "Easy Apply", "Indeed Apply",
     "Company site (Workday)" or "Email the recruiter"
3. **Apply.** The candidate picks a source; it defaults to the one with the
   cheapest working path. The apply router (`services/apply_router.py`) checks:
   - **Is this site enabled?** If not, it offers the external/email path.
   - **Account state:**
     - `connected`: the run is queued.
     - `not_connected`: the candidate is offered **Connect** (sign in once) or
       **Create account** (assisted sign-up, pre-filled).
     - `session_expired` / `challenge_required`: the candidate is offered
       **Sign in again**, with the application parked as `waiting_on_account`.
     - `restricted`: auto-apply is blocked on that site, and the candidate gets
       the manual link plus an explanation.
   - **Budget:** if today's site budget is used up, the run is scheduled for
     the next window and the candidate is told when.
   - **Profile:** if the site needs fields the candidate hasn't given
     (`form_apply_profiles`, Naukri profile), the run is parked and an
     `incomplete_profile` action opens.
4. **Fill (and submit).** A Celery worker runs the site adapter. By default it
   fills and stops; the candidate reviews the screenshots and the
   answered/unanswered questions, then confirms. With per-site auto-submit on,
   it submits. Either way, the result is a `submission_proof` receipt.
5. **Dashboard.** What's waiting on the candidate:
   - **Pending verifications:** "Enter the code Naukri texted you",
     "Confirm your Indeed email"
   - **Sign-in needed:** "LinkedIn wants you to sign in again (2FA)"
   - **Incomplete profiles:** "Naukri needs your current CTC and notice period
     before you can apply"
   - **Unanswered questions:** "Indeed asked 'Do you have a valid driving
     licence?' for Acme. Answer once; we'll remember it."
   - **Failed applications:** the reason and a **Retry** button (transient
     failures only)
   - **Success rate:** per site, last 30 days, next to the counts it's
     computed from

   Resolving an action resumes the application that was parked on it; the
   candidate doesn't have to click *Apply* again.

---

## 5. Data model

All tables use the existing `TimestampMixin` (`created_at`, `updated_at`) and
cascade on `users.id` delete. Postgres types shown; tests run on SQLite, so
avoid Postgres-only features in constraints. Enums use the existing
`FilterEnum` pattern.

### 5.1 `job_site_accounts`

One row per user per site. It replaces `linkedin_accounts`: a data migration
copies those rows across, and the old table is dropped one release later.

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | int FK users | indexed |
| `site` | enum `JobSite` | `linkedin \| indeed \| naukri \| glassdoor` |
| `auth_method` | enum | `password \| google_sso \| email_otp \| mobile_otp \| apple_sso` |
| `login_identifier` | varchar(320) | email or phone the site knows them by; shown masked in the UI |
| `password_encrypted` | text null | Fernet; only for `auth_method=password` and only on opt-in |
| `session_state_encrypted` | text null | Fernet; Playwright `storage_state` JSON |
| `session_captured_at` | timestamptz null | |
| `session_checked_at` | timestamptz null | last health check |
| `status` | enum `SiteAccountStatus` | see §3.3 |
| `status_reason` | text null | site's own wording where available |
| `profile_completeness` | jsonb | `{required: [...], missing: [...], checked_at}`; Naukri first |
| `auto_submit` | bool default false | per-site opt-in |
| `daily_apply_count` | int default 0 | rolling window, same scheme as LinkedIn today |
| `daily_window_start` | timestamptz null | |
| `last_applied_at` | timestamptz null | enforces the minimum gap |
| `restricted_at` | timestamptz null | set once, never auto-cleared |

Constraints: `UNIQUE (user_id, site)`. One account per site per user to start;
multiple identities can come later, as Gmail did.

### 5.2 `job_search_results`

One row per hit, per source, per search run. `job_postings` stays the
deduplicated entity that scoring and the pipeline use.

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | int FK users | indexed |
| `job_search_id` | int FK job_searches null | null for ad-hoc searches |
| `search_run_id` | uuid | groups one interactive search's results |
| `job_posting_id` | int FK job_postings | the deduped role this hit maps to |
| `site` | enum `JobSite` + `other` | |
| `provider` | varchar(40) | `serpapi_google_jobs`, `remoteok`, … |
| `external_id` | varchar(255) null | the board's own job id when present |
| `url` | text | the listing on that board |
| `apply_url` | text null | where *Apply* leads, if different |
| `apply_capability` | enum | `site_native \| external_ats \| external_unknown \| email \| none` |
| `ats_platform` | enum `ATSPlatform` null | when `external_ats` |
| `rank` | int | position within the run |
| `posted_at` | timestamptz null | |
| `fetched_at` | timestamptz | |

Indexes: `(user_id, search_run_id)`, `(job_posting_id, site)`. Retention is
30 days; older rows are pruned by a beat task. The `job_postings` row and its
score outlive them.

### 5.3 `application_attempts`

One row per attempt to apply to one result through one path. This is a
generalisation of `form_applications`, which already holds most of these
columns. **Recommendation:** add the new columns to `form_applications` and
expose it as `application_attempts` through the model and API, rather than
running two tables that mean the same thing. The columns below are the target
shape, with new ones marked ★.

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | int FK users | |
| `job_posting_id` | int FK job_postings null | |
| ★ `job_search_result_id` | int FK job_search_results null | which source was chosen |
| ★ `site_account_id` | int FK job_site_accounts null | null for pure external ATS |
| ★ `path` | enum | `site_native \| external_ats \| site_then_ats` |
| `platform` | enum `ATSPlatform` | add `INDEED`, `NAUKRI`, `GLASSDOOR` |
| `resume_id` | int FK resumes null | |
| `status` | enum `FormApplyStatus` | add ★ `WAITING_ON_ACCOUNT`, ★ `SCHEDULED` |
| `submit_requested` | bool | |
| ★ `scheduled_for` | timestamptz null | budget-deferred runs |
| `attempts` / `max_attempts` | int | |
| `filled_fields`, `answers`, `unanswered`, `steps` | jsonb | as today |
| `confirmation` | text null | employer/site wording, verbatim |
| ★ `site_application_id` | varchar(255) null | board's own application reference, for status sync |
| `error`, `note` | text null | |
| ★ `failure_kind` | enum null | `transient \| needs_input \| blocked \| form_changed \| restricted` (§6) |
| `started_at`, `finished_at`, `duration_ms` | | |

Constraint: at most one `SUBMITTED` attempt per `(user_id, job_posting_id)`.
The existing double-submit guard is enforced here as a partial unique index on
Postgres, with an application-level check on SQLite.

### 5.4 `pending_actions`

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | int FK users | indexed with `status` |
| `kind` | enum | `verify_email \| verify_phone \| sign_in \| solve_challenge \| complete_profile \| answer_question \| review_submission \| retry_failed \| account_restricted` |
| `site` | enum `JobSite` null | |
| `site_account_id` | int FK null | |
| `application_attempt_id` | int FK null | the parked application this unblocks |
| `title` | varchar(200) | what the candidate reads |
| `detail` | jsonb | kind-specific: missing fields, the question text, the challenge screenshot path |
| `action_url` | text | in-app deep link |
| `status` | enum | `open \| resolved \| dismissed \| expired` |
| `dedupe_key` | varchar(200) | same semantics as `notifications.dedupe_key` |
| `expires_at` | timestamptz null | e.g. OTP windows |
| `resolved_at` | timestamptz null | |

Constraint: `UNIQUE (user_id, dedupe_key) WHERE status = 'open'`, so re-raising
the same condition updates the open row instead of adding another.

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **ToS violation.** All four sites prohibit automated access, and LinkedIn enforces it in court (*hiQ*, Proxycurl). | Certain (it *is* a violation) | High: the candidate's account is restricted, and there's legal exposure for DoAide | Discovery only through licensed/public sources. Board automation is off by default per site, the operator turns it on knowingly, and the candidate gets a plain-language explanation of the risk to *their* account before connecting. Pursue partner programmes (Indeed Apply / Naukri partner APIs) in parallel, and prefer them the moment one exists. Get legal review before Phase 2 ships to all users. |
| **Anti-bot detection** (fingerprinting, velocity, Cloudflare, CAPTCHA) | High | High: account restriction, and the candidate's job search damaged | Stop at every challenge and never evade (§1). Reuse sessions instead of signing in repeatedly. Use conservative per-site pacing with jitter, and assisted sessions from the candidate's own browser where possible. Track restriction rate per site as a kill-switch metric: pause the site for everyone if it exceeds 1% of active accounts in a week. |
| **Rate limiting / throttling** | High | Medium | Per-site rolling budgets and minimum gaps (§3.2), plus exponential backoff on 429/5xx through the existing `browser_runner` retries. Budget-deferred runs are `SCHEDULED`, not failed. SerpApi spend is capped by the 15-minute cache and a per-user search quota. |
| **Form/flow changes** | Certain, frequently | Medium: applications fail until the adapter is fixed | Selector fallbacks (`data-*` → role/label → text), the same as the Workday adapter. Each adapter is tested against saved fixtures. A nightly synthetic run against a test account per site flags a broken adapter before users do. `failure_kind=form_changed` is surfaced on the admin dashboard and auto-pauses that site's auto-submit after N consecutive occurrences. |
| **Wrong or invented answers** to screening questions | Medium | High: a false statement on an application | Legally significant answers come only from `form_apply_profiles`. An ungrounded question means `NEEDS_INPUT`, never a guess. Every answer is recorded on the attempt and shown before submit. |
| **Credential/session theft** | Low | Very high | Fernet at rest, decryption only inside workers, no secrets in logs or responses (existing `untrusted.py`/logging conventions), sessions preferred over passwords, immediate deletion on disconnect. The extension (if chosen) requests one domain at a time, and its scope is listed in the privacy policy. |
| **Double submission** | Low | High (looks careless to the employer) | Single `SUBMITTED` attempt per posting (§5.3), and row claiming as in `form_apply_service.run_application`. No retry once the submit click has happened. |
| **Privacy/compliance** (DPDP Act in India, GDPR) | Medium | High | Update `privacy.html` and the Google OAuth verification docs to cover the new data. Cover the new tables in account deletion and export. Results retained 30 days. |
| **Phone-OTP dependence (Naukri)** | Certain | Medium: every new device needs the candidate | Session reuse keeps OTPs rare. The OTP pending action expires with the code, so a stale prompt never lingers. |

---

## 7. Implementation phases

### Phase 1: search aggregation + dashboard (≈3–4 weeks)

No board automation. Everything here is safe to ship to all users.

- `job_search_results` table; per-source rows and `apply_capability`
  classification in `job_search_service`.
- Interactive search endpoint (`POST /job-search`) with concurrent providers,
  a time budget and a 15-minute cache. Validate SerpApi's Naukri coverage
  (§3.1).
- Results UI: one card per role, source badges, fit score, apply path per
  source. *Apply* in this phase:
  - opens the listing on the board
  - routes to the existing ATS adapter for `external_ats`
  - routes to outreach for `email`
- `pending_actions` table and service; migrate the existing "needs you" signals
  into it (form-apply `NEEDS_INPUT`, LinkedIn `challenge_required`, drafts
  waiting for Send via Gmail).
- Dashboard: pending actions, failed applications, success rate (from existing
  `form_applications` plus outreach).
- `job_site_accounts` table and LinkedIn migration (read-only Accounts page
  showing status).

**Exit criteria:**
- Median search returns in under 4 s.
- Fewer than 5% duplicate cards.
- Dashboard numbers match a manual count for 10 sample users.

### Phase 2: auto-apply on two sites (≈6–8 weeks)

**Sites: LinkedIn and Naukri.** LinkedIn because the Easy Apply adapter
already exists and moves rather than gets written. Naukri because DoAide's
market is India, Naukri's one-click apply has the simplest form, and its
sign-in is plain email/password plus OTP, which needs no SSO.

- Legal review of ToS exposure; per-site deployment flags; candidate-facing
  risk explainer.
- Site adapter framework (`site_adapters/`), LinkedIn moved in, Naukri adapter,
  and board → ATS hand-off.
- Account manager:
  - connect and disconnect
  - session capture via the assisted-session option chosen in the spike
    (extension vs remote browser)
  - health checks
  - per-site budgets and pacing
- Assisted sign-up for Naukri (pre-fill, then the OTP pending action).
- Naukri profile sync and the `complete_profile` action.
- `form_applications` → `application_attempts` columns; the `WAITING_ON_ACCOUNT`
  resume path; receipts.
- Nightly synthetic runs and fixture tests per adapter; kill-switch metric.

**Exit criteria:**
- At least 85% of attempts on a connected, complete account end `SUBMITTED` or
  `FILLED`.
- Restriction rate under 1%.
- No double submissions.

### Phase 3: Indeed, Glassdoor, Google SSO (≈6–8 weeks)

- Indeed adapter (Indeed Apply, including screeners), plus the email-OTP
  sign-in path.
- Glassdoor adapter. Reuse Indeed's where Glassdoor's apply flow is
  Indeed-powered; confirm the current state in the spike.
- Google SSO for all four sites via the assisted session: the candidate signs
  in with Google, and we keep the site's session only.
- Session-expiry handling tuned for SSO accounts, which can't be refreshed
  without the candidate.
- Multiple accounts per site, if demand shows up.

**Exit criteria:** the same as Phase 2, across all four sites.

---

## Open questions

1. Extension or remote browser for assisted sessions, or both? (§3.3)
2. Default per-site auto-submit: off for everyone (recommended), or on after
   the candidate has confirmed N applications on that site, like the outreach
   trial in `send_policy.py`?
3. Is Naukri coverage through Google Jobs good enough, or is a Naukri
   partnership worth pursuing before Phase 2?
4. Which tier pays for this? Board auto-apply costs browser minutes and SerpApi
   calls per application; it likely belongs in a paid plan.
