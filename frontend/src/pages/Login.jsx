import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import Logo from "../components/ui/Logo";

export default function Login() {
  const { user, login, register } = useAuth();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === "signup";

  if (user) return <Navigate to="/" replace />;

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
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5 py-16">
      <div className="stagger w-full max-w-[380px]">
        <div className="mb-10 text-center">
          <Logo className="mx-auto mb-5 h-12 w-12 text-brand-500" />
          <h1 className="text-[42px] font-extrabold leading-none tracking-tightest text-ink-900">
            DoAide <span className="text-ink-400">|</span> <span className="text-brand-500">AutoApply</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-500">
            Upload a resume. We find the recruiters,
            <br />
            write the emails, and track the replies.
          </p>
        </div>

        <form onSubmit={onSubmit} className="panel space-y-4 p-6 shadow-lift">
          {isSignUp && (
            <div>
              <label className="label" htmlFor="name">
                Name <span className="normal-case tracking-normal">(optional)</span>
              </label>
              <input
                id="name"
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Read from your resume if blank"
                autoComplete="name"
              />
            </div>
          )}

          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              className="input font-mono"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              className="input font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignUp ? "At least 8 characters" : "••••••••"}
              autoComplete={isSignUp ? "new-password" : "current-password"}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-bad/25 bg-bad-wash px-3 py-2 text-xs text-bad">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "One moment…" : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-400">
          {isSignUp ? "Already have an account?" : "First time here?"}{" "}
          <button
            type="button"
            className="text-brand-500 underline-offset-4 hover:underline"
            onClick={() => {
              setMode(isSignUp ? "signin" : "signup");
              setError(null);
            }}
          >
            {isSignUp ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
