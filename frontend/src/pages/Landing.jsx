import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import DoAideFooter from "../components/DoAideFooter";

const ACCENT = "#0D9488";

const TYPEWRITER_PHRASES = [
  "Smart job matching",
  "Automated applications",
  "AI resume tailoring",
  "Interview-ready pipeline",
];

const DOAIDE_PRODUCTS = [
  { name: "Desk",   url: "https://desk.doaide.com" },
  { name: "Jobs",   url: "https://job.doaide.com" },
  { name: "409A",   url: "https://409a.doaide.com" },
  { name: "GST",    url: "https://gst.doaide.com" },
  { name: "Pulse",  url: "https://pulse.doaide.com" },
  { name: "Med",    url: "https://med.doaide.com" },
  { name: "Realty", url: "https://realty.doaide.com" },
  { name: "Reach",  url: "https://reach.doaide.com" },
  { name: "Trade",  url: "https://trade.doaide.com" },
];

/* ---------- particles ---------- */

function Particles() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    let particles = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 0.5,
        dx: (Math.random() - 0.5) * 0.3,
        dy: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.3 + 0.05,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(13, 148, 136, ${p.opacity})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-particles" />;
}

/* ---------- pipeline visualization ---------- */

const PIPELINE_STAGES = [
  {
    label: "Search",
    icon: (
      <>
        <circle cx="12" cy="11" r="5" stroke={ACCENT} strokeWidth="1.8" fill="none" />
        <line x1="15.5" y1="14.5" x2="20" y2="19" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  {
    label: "Match",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" stroke={ACCENT} strokeWidth="1.8" fill="none" />
        <circle cx="12" cy="12" r="1.5" fill={ACCENT} />
        <line x1="12" y1="4" x2="12" y2="6" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round" />
        <line x1="12" y1="18" x2="12" y2="20" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round" />
        <line x1="4" y1="12" x2="6" y2="12" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round" />
        <line x1="18" y1="12" x2="20" y2="12" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round" />
      </>
    ),
  },
  {
    label: "Apply",
    icon: (
      <>
        <path d="M12 4 L12 16" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7 9 L12 4 L17 9" stroke={ACCENT} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="5" y1="20" x2="19" y2="20" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  {
    label: "Interview",
    icon: (
      <>
        <rect x="4" y="6" width="16" height="14" rx="2" stroke={ACCENT} strokeWidth="1.6" fill="none" />
        <line x1="4" y1="11" x2="20" y2="11" stroke={ACCENT} strokeWidth="1.2" />
        <line x1="8" y1="6" x2="8" y2="3" stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="16" y1="6" x2="16" y2="3" stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="15.5" r="1.2" fill={ACCENT} />
        <circle cx="14.5" cy="15.5" r="1.2" fill={ACCENT} />
      </>
    ),
  },
];

function PipelineViz() {
  const nodeW = 80;
  const nodeH = 70;
  const gap = 44;
  const totalW = PIPELINE_STAGES.length * nodeW + (PIPELINE_STAGES.length - 1) * gap;
  const svgH = nodeH + 16;

  return (
    <div className="landing-pipeline-wrap">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${totalW} ${svgH}`}
        className="landing-pipeline"
        aria-label="Pipeline: Search, Match, Apply, Interview"
        role="img"
      >
        <defs>
          <filter id="pipe-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {PIPELINE_STAGES.map((stage, i) => {
          const x = i * (nodeW + gap);
          const centerY = svgH / 2 - 6;

          return (
            <g key={stage.label}>
              {i < PIPELINE_STAGES.length - 1 && (
                <g>
                  <line
                    x1={x + nodeW}
                    y1={centerY}
                    x2={x + nodeW + gap}
                    y2={centerY}
                    stroke="rgba(13,148,136,0.15)"
                    strokeWidth="2"
                  />
                  {[0, 1, 2].map((d) => (
                    <circle key={d} r="2.5" fill={ACCENT} filter="url(#pipe-glow)">
                      <animateMotion
                        dur="1.8s"
                        repeatCount="indefinite"
                        begin={`${d * 0.6}s`}
                        path={`M${x + nodeW},${centerY} L${x + nodeW + gap},${centerY}`}
                      />
                      <animate
                        attributeName="opacity"
                        values="0;1;1;0"
                        dur="1.8s"
                        repeatCount="indefinite"
                        begin={`${d * 0.6}s`}
                      />
                    </circle>
                  ))}
                </g>
              )}

              <rect
                x={x}
                y={centerY - nodeH / 2}
                width={nodeW}
                height={nodeH}
                rx="14"
                fill="var(--bg-card)"
                stroke="rgba(13,148,136,0.2)"
                strokeWidth="1"
                className="landing-pipeline-node"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
              <rect
                x={x + 4}
                y={centerY - nodeH / 2 + 4}
                width={nodeW - 8}
                height={nodeH - 8}
                rx="10"
                fill="none"
                stroke="rgba(13,148,136,0.06)"
                strokeWidth="8"
                filter="url(#pipe-glow)"
              />

              <g transform={`translate(${x + nodeW / 2 - 12}, ${centerY - 16})`}>
                {stage.icon}
              </g>

              <text
                x={x + nodeW / 2}
                y={centerY + 28}
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize="10"
                fontFamily="'IBM Plex Mono', monospace"
                fontWeight="500"
                letterSpacing="0.04em"
              >
                {stage.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------- typewriter ---------- */

function Typewriter({ phrases }) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const phrase = phrases[phraseIdx];
    let timeout;

    if (!deleting && charIdx < phrase.length) {
      timeout = setTimeout(() => setCharIdx(charIdx + 1), 70);
    } else if (!deleting && charIdx === phrase.length) {
      timeout = setTimeout(() => setDeleting(true), 2000);
    } else if (deleting && charIdx > 0) {
      timeout = setTimeout(() => setCharIdx(charIdx - 1), 40);
    } else if (deleting && charIdx === 0) {
      setDeleting(false);
      setPhraseIdx((phraseIdx + 1) % phrases.length);
    }

    return () => clearTimeout(timeout);
  }, [charIdx, deleting, phraseIdx, phrases]);

  return (
    <span className="landing-typewriter">
      <span className="landing-typewriter-text">
        {phrases[phraseIdx].slice(0, charIdx)}
      </span>
      <span className="landing-typewriter-cursor" />
    </span>
  );
}

/* ---------- auth form ---------- */

function AuthForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === "signup";

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignUp) await register(email, password, fullName || null);
      else await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing-auth">
      <div className="landing-auth-tabs">
        <button
          type="button"
          className={`landing-auth-tab ${!isSignUp ? "landing-auth-tab-active" : ""}`}
          onClick={() => { setMode("signin"); setError(null); }}
        >
          Sign In
        </button>
        <button
          type="button"
          className={`landing-auth-tab ${isSignUp ? "landing-auth-tab-active" : ""}`}
          onClick={() => { setMode("signup"); setError(null); }}
        >
          Create Account
        </button>
      </div>

      <form onSubmit={onSubmit} className="landing-auth-form">
        {isSignUp && (
          <div className="landing-auth-field">
            <label className="landing-auth-label" htmlFor="landing-name">Name (optional)</label>
            <input
              id="landing-name"
              className="landing-auth-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Read from your resume if blank"
              autoComplete="name"
            />
          </div>
        )}

        <div className="landing-auth-field">
          <label className="landing-auth-label" htmlFor="landing-email">Email</label>
          <input
            id="landing-email"
            type="email"
            required
            className="landing-auth-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div className="landing-auth-field">
          <label className="landing-auth-label" htmlFor="landing-password">Password</label>
          <input
            id="landing-password"
            type="password"
            required
            minLength={8}
            className="landing-auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignUp ? "At least 8 characters" : "••••••••"}
            autoComplete={isSignUp ? "new-password" : "current-password"}
          />
        </div>

        {error && <p className="landing-auth-error">{error}</p>}

        <button type="submit" className="landing-btn-primary landing-btn-form" disabled={busy}>
          {busy ? "One moment…" : isSignUp ? "Create account" : "Sign in"}
        </button>
      </form>

      <div className="landing-auth-divider">
        <span>or continue with</span>
      </div>

      <div className="landing-sso-buttons">
        <a href="/api/v1/auth/sso/google" className="landing-sso-btn">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.7 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.5 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.4 6.9-17.7z" />
            <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z" />
            <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.7-6c-2.1 1.4-4.8 2.3-7.5 2.3-6.3 0-11.6-4-13.5-9.6l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
          </svg>
          Google
        </a>
        <a href="/api/v1/auth/sso/github" className="landing-sso-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          GitHub
        </a>
        <a href="/api/v1/auth/sso/microsoft" className="landing-sso-btn">
          <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
            <rect fill="#f25022" x="1" y="1" width="10" height="10" />
            <rect fill="#00a4ef" x="1" y="12" width="10" height="10" />
            <rect fill="#7fba00" x="12" y="1" width="10" height="10" />
            <rect fill="#ffb900" x="12" y="12" width="10" height="10" />
          </svg>
          Microsoft
        </a>
      </div>

      <p className="landing-auth-hint">
        {isSignUp ? "Free to start. No credit card." : "Welcome back."}
      </p>
    </div>
  );
}

/* ---------- main landing page ---------- */

export default function Landing() {
  const { user, loading } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  if (loading) {
    return (
      <div className="landing-root" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em" }}>
          Loading
        </span>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  return (
    <div className="landing-root">
      <Particles />

      {/* Header */}
      <header className={`landing-header ${visible ? "landing-visible" : ""}`}>
        <a href="https://doaide.com" className="landing-brand" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <rect x="2" y="2" width="28" height="28" rx="6" fill={ACCENT} />
            <text x="16" y="22" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="700" fontSize="16" fill="white">J</text>
          </svg>
          <span className="landing-brand-text">
            DoAide <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>|</span> <em>AutoApply</em>
          </span>
        </a>
      </header>

      {/* Split layout */}
      <main className={`landing-split ${visible ? "landing-visible" : ""}`}>
        <div className="landing-left">
          <div className="landing-left-content">
            <h1 className="landing-headline">
              Job applications, <em>automated.</em>
            </h1>

            <p className="landing-subtitle">
              AI finds, matches, and applies to jobs for you — while you focus on interviews.
            </p>

            <PipelineViz />

            <div className="landing-typewriter-wrap">
              <Typewriter phrases={TYPEWRITER_PHRASES} />
            </div>
          </div>
        </div>

        <div className="landing-right">
          <AuthForm />
        </div>
      </main>

      <DoAideFooter />

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-products">
          {DOAIDE_PRODUCTS.map((p) => (
            <a key={p.name} href={p.url} className="landing-footer-link" target="_blank" rel="noopener noreferrer">
              {p.name}
            </a>
          ))}
        </div>
        <div className="landing-footer-bottom">
          <a href="https://doaide.com" className="landing-footer-home" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 32 32" width="16" height="16">
              <rect x="2" y="2" width="28" height="28" rx="6" fill={ACCENT} />
              <text x="16" y="22" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="700" fontSize="16" fill="white">D</text>
            </svg>
            doaide.com
          </a>
          <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
            <a href="https://doaide.com" className="landing-footer-link" style={{ border: "1px solid var(--da-border)", borderRadius: "999px", padding: "2px 10px", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }} target="_blank" rel="noopener noreferrer">
              A DoAide Product
            </a>
          </span>
          <span className="landing-footer-copy">&copy; {new Date().getFullYear()} DoAide</span>
        </div>
      </footer>
    </div>
  );
}
