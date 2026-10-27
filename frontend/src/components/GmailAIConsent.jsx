import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function GmailAIConsent() {
  const [consent, setConsent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => api.gmailAIConsent()).then((value) => {
      if (active) setConsent(value);
    }).catch(() => {
      if (active) setError("Could not load privacy settings. AI email processing stays off without recorded consent.");
    });
    return () => { active = false; };
  }, []);

  async function change(enabled) {
    setBusy(true);
    setError("");
    try {
      setConsent(await api.setGmailAIConsent(enabled, consent.version));
    } catch (err) {
      setError(err.message || "Could not save privacy settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 border-t border-white/10 pt-4" aria-label="Email AI privacy">
      <p className="text-sm leading-relaxed text-white/60">
        Optional AI email assistance sends selected Gmail sender details, subjects,
        message excerpts, and relevant resume/profile context to Groq inference
        with verified zero-retention settings, or OpenRouter and its eligible
        no-data-collection, zero-retention model providers, for classification and drafting. Your Gmail tokens
        are never included. Without consent or an eligible provider, local rules
        and templates are used. Revoking consent stops new AI requests, not
        messages already sent. <a className="underline" href="/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a>
      </p>
      <label className="flex items-start gap-2 text-sm text-white/80">
        <input type="checkbox" className="mt-1" checked={consent?.enabled === true}
          disabled={!consent || busy} onChange={(event) => change(event.target.checked)} />
        <span>I consent to this external AI processing of my email and profile data.</span>
      </label>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </section>
  );
}
