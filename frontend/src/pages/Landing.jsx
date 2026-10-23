import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import DoAideFooter from "../components/DoAideFooter";
import ThemeToggle from "../components/ThemeToggle";
import Logo from "../components/ui/Logo";

// The public face of AutoApply: a Pulse-style landing page with sign-in and
// sign-up embedded in the hero. Like Pulse's, the whole page is near-black and
// teal in both themes: the root carries the `dark` class, so the themed
// palette (doaide-theme.css) resolves to its dark values inside it whatever
// the app theme is. The theme switch still sets the app's theme.

const HERO_BG = "#0A0A0B";
const ACCENT = "#0D9488";

const DOAIDE_PRODUCTS = [
  { name: "Desk", url: "https://desk.doaide.com" },
  { name: "Pulse", url: "https://pulse.doaide.com" },
  { name: "409A", url: "https://409a.doaide.com" },
  { name: "GST", url: "https://gst.doaide.com" },
  { name: "Med", url: "https://med.doaide.com" },
  { name: "Realty", url: "https://realty.doaide.com" },
  { name: "Reach", url: "https://reach.doaide.com" },
  { name: "Trade", url: "https://trade.doaide.com" },
];

/* ---------- icons (24×24 stroke glyphs) ---------- */

function Glyph({ d, className = "h-5 w-5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}

const ICONS = {
  upload: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M12 18v-6M9 15l3-3 3 3" />
    </>
  ),
  match: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </>
  ),
  tailor: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  send: (
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </>
  ),
  interview: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18M9 15l2 2 4-4" />
    </>
  ),
  recruiter: (
    <>
      <circle cx="11" cy="8" r="4" />
      <path d="M3 21v-1a6 6 0 0 1 9.5-4.9" />
      <circle cx="17.5" cy="17.5" r="3" />
      <path d="m21.5 21.5-1.8-1.8" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  followup: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  pipeline: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 16v-3M12 16V9M17 16V6" />
    </>
  ),
  ghost: (
    <>
      <path d="M9 10h.01M15 10h.01" />
      <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
};

/* ---------- content ---------- */

export const WORKFLOW = [
  { label: "Upload", icon: "upload" },
  { label: "Match", icon: "match" },
  { label: "Tailor", icon: "tailor" },
  { label: "Reach out", icon: "send" },
  { label: "Interview", icon: "interview" },
];

const STATS = [
  { value: "5", label: "steps from resume to interview" },
  { value: "1:1", label: "emails from your own Gmail" },
  { value: "1-click", label: "approve & send AI drafts" },
  { value: "24/7", label: "job matching on autopilot" },
];

const FEATURES = [
  {
    title: "Smart Job Matching",
    icon: "match",
    body: "Every new posting is scored against your resume and preferences, so the shortlist is the jobs worth your time.",
  },
  {
    title: "Recruiter Discovery",
    icon: "recruiter",
    body: "AutoApply finds the hiring manager or recruiter behind a role and verifies the address before anything is sent.",
  },
  {
    title: "AI Resume Tailoring",
    icon: "tailor",
    body: "A version of your resume and a cover note shaped to each job description — reviewed by you before it goes.",
  },
  {
    title: "Emails From Your Gmail",
    icon: "send",
    body: "Outreach goes one-to-one from your own mailbox, written in your voice, so replies land straight in your inbox.",
  },
  {
    title: "Reply Inbox",
    icon: "inbox",
    body: "Recruiter replies are read and sorted — interview requests, questions, rejections — with a suggested answer ready.",
  },
  {
    title: "Polite Follow-ups",
    icon: "followup",
    body: "A gentle nudge after a few quiet days, stopped the moment someone replies. Never a blast.",
  },
  {
    title: "Ghost-Job Filter",
    icon: "ghost",
    body: "Stale and evergreen listings are flagged before you spend an application on a role nobody is hiring for.",
  },
  {
    title: "Pipeline Tracker",
    icon: "pipeline",
    body: "From applied to offer on one board, with reply rates and what to do next for every application.",
  },
];

/* ---------- hero robot (Pulse's mascot) ---------- */

// Pulse's hero robot in the same teal, floating with a pulsing antenna and
// blinking eyes (animations in index.css).
export function HeroRobot() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 180 150"
      width="180"
      height="150"
      className="hero-robot"
      role="img"
      aria-label="DoAide mascot"
    >
      <line x1="90" y1="28" x2="90" y2="10" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
      <circle cx="90" cy="7" r="5" fill={ACCENT} className="antenna-glow" />
      <circle cx="90" cy="7" r="2.5" fill="#2DD4BF" />
      <rect x="35" y="28" width="110" height="80" rx="22" fill={ACCENT} />
      <rect x="50" y="40" width="80" height="58" rx="14" fill="#0F766E" opacity="0.3" />
      <g className="robot-eye">
        <ellipse cx="62" cy="62" rx="12" ry="14" fill="#FFFFFF" />
        <circle cx="65" cy="59" r="5" fill="#042F2E" />
        <circle cx="67" cy="56" r="2" fill="white" opacity="0.7" />
      </g>
      <g className="robot-eye">
        <ellipse cx="118" cy="62" rx="12" ry="14" fill="#FFFFFF" />
        <circle cx="121" cy="59" r="5" fill="#042F2E" />
        <circle cx="123" cy="56" r="2" fill="white" opacity="0.7" />
      </g>
      <path d="M68 88Q90 102 112 88" stroke="#FFFFFF" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="14" y="48" width="18" height="28" rx="7" fill={ACCENT} opacity="0.8" />
      <rect x="148" y="48" width="18" height="28" rx="7" fill={ACCENT} opacity="0.8" />
      <rect x="75" y="108" width="30" height="10" rx="4" fill="#0F766E" />
      <rect x="52" y="118" width="76" height="28" rx="12" fill={ACCENT} />
      <circle cx="90" cy="130" r="5" fill="#0A0A0B" />
    </svg>
  );
}

/* ---------- auth card ---------- */

const inputClass =
  "w-full rounded-lg border border-white/[0.12] bg-[#0A0A0B]/60 px-3.5 py-2.5 text-sm text-white transition-colors placeholder:text-white/35 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400";
const labelClass = "mb-1.5 block text-sm font-medium text-white/80";

// What the SSO callbacks put in `?error=` when they send someone back here.
const SSO_ERRORS = {
  google_auth_failed: "Google sign-in didn't complete. Please try again.",
  github_auth_failed: "GitHub sign-in didn't complete. Please try again.",
  microsoft_auth_failed: "Microsoft sign-in didn't complete. Please try again.",
  no_email: "Your account didn't share an email address, so we couldn't sign you in.",
  account_deactivated: "This account has been deactivated.",
};

function takeSsoError() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("error");
  if (!code) return null;
  params.delete("error");
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
  return SSO_ERRORS[code] || "Sign-in didn't complete. Please try again.";
}

const SSO = [
  {
    id: "google",
    name: "Google",
    href: "/api/v1/auth/sso/google",
    icon: (
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.7 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.5 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.4 6.9-17.7z" />
        <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z" />
        <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.7-6c-2.1 1.4-4.8 2.3-7.5 2.3-6.3 0-11.6-4-13.5-9.6l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
      </svg>
    ),
  },
  {
    id: "github",
    name: "GitHub",
    href: "/api/v1/auth/sso/github",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
    ),
  },
  {
    id: "microsoft",
    name: "Microsoft",
    href: "/api/v1/auth/sso/microsoft",
    icon: (
      <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true">
        <rect fill="#f25022" x="1" y="1" width="10" height="10" />
        <rect fill="#00a4ef" x="1" y="12" width="10" height="10" />
        <rect fill="#7fba00" x="12" y="1" width="10" height="10" />
        <rect fill="#ffb900" x="12" y="12" width="10" height="10" />
      </svg>
    ),
  },
];

export function AuthCard({ initialMode = "signin" }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState(takeSsoError);
  const [busy, setBusy] = useState(false);
  // Only providers the server has credentials for: an unconfigured one answers 501.
  const [sso, setSso] = useState([]);

  useEffect(() => {
    let live = true;
    api
      .ssoProviders()
      .then((res) => live && setSso(SSO.filter((p) => res.providers?.includes(p.id))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const signingUp = mode === "signup";

  function switchMode(next) {
    setMode(next);
    setError(null);
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (signingUp) await register(email, password, fullName || null);
      else await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const tabClass = (on) =>
    `flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      on ? "bg-white/[0.08] text-teal-300" : "text-white/50 hover:text-white"
    }`;

  return (
    <div className="w-full rounded-2xl border border-white/[0.07] bg-[#101012]/80 p-6 shadow-2xl shadow-black/60 backdrop-blur sm:p-7">
      <h2 className="text-lg font-semibold tracking-tight text-white">
        {signingUp ? "Create your account" : "Sign in to your account"}
      </h2>
      <p className="mt-1 text-sm text-white/50">
        {signingUp ? "Free to start. No credit card." : "Welcome back to DoAide AutoApply."}
      </p>

      <div
        role="tablist"
        aria-label="Account"
        className="mt-5 flex gap-1 rounded-lg border border-white/[0.06] bg-[#1A1A1D] p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!signingUp}
          onClick={() => switchMode("signin")}
          className={tabClass(!signingUp)}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={signingUp}
          onClick={() => switchMode("signup")}
          className={tabClass(signingUp)}
        >
          Create account
        </button>
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        {signingUp && (
          <div>
            <label htmlFor="landing-name" className={labelClass}>
              Name <span className="font-normal text-white/40">(optional)</span>
            </label>
            <input
              id="landing-name"
              className={inputClass}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Read from your resume if blank"
              autoComplete="name"
            />
          </div>
        )}
        <div>
          <label htmlFor="landing-email" className={labelClass}>
            Email
          </label>
          <input
            id="landing-email"
            type="email"
            required
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <div>
          <label htmlFor="landing-password" className={labelClass}>
            Password
          </label>
          <input
            id="landing-password"
            type="password"
            required
            minLength={8}
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={signingUp ? "At least 8 characters" : "••••••••"}
            autoComplete={signingUp ? "new-password" : "current-password"}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 focus:ring-offset-[#0A0A0B] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "One moment…" : signingUp ? "Create account" : "Sign in"}
        </button>
      </form>

      {sso.length > 0 && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-white/40">
            <span className="h-px flex-1 bg-white/[0.08]" />
            or continue with
            <span className="h-px flex-1 bg-white/[0.08]" />
          </div>

          <div className={`grid gap-2 ${sso.length === 1 ? "grid-cols-1" : sso.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
            {sso.map((p) => (
              <a
                key={p.name}
                href={p.href}
                className="flex items-center justify-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2 py-2 text-xs font-medium text-white/80 no-underline transition-colors hover:border-teal-400/50 hover:bg-white/[0.06] hover:text-white"
              >
                {p.icon}
                {p.name}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- page ---------- */

export default function Landing() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: HERO_BG }}
      >
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">Loading</span>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  return (
    <div
      data-testid="landing"
      className="dark min-h-screen bg-canvas text-ink-700"
      style={{ colorScheme: "dark" }}
    >
      {/* Hero — Pulse near-black and teal in both themes */}
      <section className="relative overflow-hidden text-[#E4E4E7]" style={{ backgroundColor: HERO_BG }}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(50% 45% at 20% 30%, rgba(13,148,136,0.12), transparent 70%), radial-gradient(35% 35% at 85% 70%, rgba(45,212,191,0.06), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <header className="flex items-center justify-between gap-3 py-5">
            <a
              href="https://doaide.com"
              className="flex items-center gap-2.5 no-underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Logo className="h-[30px] w-[30px] text-teal-600" title="DoAide AutoApply" />
              <span className="text-[19px] font-bold tracking-tight text-white">
                DoAide{" "}
                <span className="font-normal text-white/30" aria-hidden="true">
                  |
                </span>{" "}
                <em className="text-teal-300">AutoApply</em>
              </span>
            </a>
            <ThemeToggle variant="onDark" />
          </header>

          <div className="grid items-center gap-10 pb-14 pt-6 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pb-20 lg:pt-12">
            <div className="text-center lg:text-left">
              <div className="flex justify-center lg:justify-start">
                <div className="hero-robot-float">
                  <HeroRobot />
                </div>
              </div>
              <h1 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
                AI-powered{" "}
                <span className="font-display font-normal italic text-teal-400">job application</span>{" "}
                platform
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-base text-[#A1A1AA] sm:text-lg lg:mx-0">
                Upload your resume. AutoApply finds the right jobs, tailors your application and
                writes to the recruiter — while you prepare for interviews.
              </p>

              <ol
                aria-label="How AutoApply works"
                className="mt-8 flex flex-wrap items-center justify-center gap-y-3 lg:justify-start"
              >
                {WORKFLOW.map(({ label, icon }, i) => (
                  <li key={label} className="flex items-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.06] bg-[#1A1A1D] text-teal-400">
                        <Glyph d={ICONS[icon]} />
                      </span>
                      <span className="text-xs font-medium text-[#A1A1AA]">{label}</span>
                    </div>
                    {i < WORKFLOW.length - 1 && (
                      <span aria-hidden="true" className="mx-1.5 mb-5 text-teal-600/60 sm:mx-2.5">
                        <Glyph d={ICONS.chevron} className="h-4 w-4" />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            <div className="mx-auto w-full max-w-md lg:mx-0 lg:justify-self-end">
              <AuthCard />
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="relative border-t border-white/[0.06] bg-white/[0.02]">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-y-6 px-4 py-8 sm:px-6 lg:grid-cols-4 lg:px-8">
            {STATS.map((s) => (
              <div key={s.label} className="flex flex-col-reverse text-center">
                <dt className="mt-2 font-mono text-[11px] uppercase tracking-wider text-[#71717A] sm:text-xs">
                  {s.label}
                </dt>
                <dd className="font-display text-3xl italic leading-none text-teal-400 sm:text-4xl">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Features — dark-gray cards with thin borders, as on Pulse */}
      <section
        aria-labelledby="features-heading"
        className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20"
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand-500">
            Everything in one place
          </p>
          <h2
            id="features-heading"
            className="mt-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl"
          >
            From resume to interview
          </h2>
          <p className="mt-3 text-ink-500">
            The work of a job search, with AI doing the legwork and you making the calls.
          </p>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ title, icon, body }) => (
            <li
              key={title}
              className="rounded-2xl border border-line bg-paper p-5 transition hover:border-brand-500/40"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-500">
                <Glyph d={ICONS[icon]} />
              </span>
              <h3 className="mt-4 font-semibold text-ink-900">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <DoAideFooter />

      {/* DoAide product links */}
      <footer className="border-t border-line px-4 py-6">
        <nav
          aria-label="DoAide products"
          className="mb-3 flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em]"
        >
          {DOAIDE_PRODUCTS.map((p) => (
            <a
              key={p.name}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-400 no-underline transition-colors hover:text-brand-500"
            >
              {p.name}
            </a>
          ))}
        </nav>
        <p className="flex flex-wrap items-center justify-center gap-2 text-xs text-ink-400">
          <a
            href="https://doaide.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-line px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-400 no-underline transition-colors hover:border-brand-500 hover:text-brand-500"
          >
            A DoAide Product
          </a>
          <span aria-hidden="true">&middot;</span>
          <a href="/privacy" className="text-ink-400 no-underline hover:text-brand-500">
            Privacy
          </a>
          <span aria-hidden="true">&middot;</span>
          <a href="/terms" className="text-ink-400 no-underline hover:text-brand-500">
            Terms
          </a>
          <span aria-hidden="true">&middot;</span>
          <span>&copy; {new Date().getFullYear()} DoAide</span>
        </p>
      </footer>
    </div>
  );
}
