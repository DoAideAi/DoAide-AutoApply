import { useState } from "react";
import PublicLayout from "../../components/PublicLayout";
import ShareButtons from "../../components/ShareButtons";
import { api } from "../../lib/api";

function generateLetter({ name, company, jobTitle, skills, interest }) {
  const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
  const skillsText = skillList.length > 2
    ? `${skillList.slice(0, -1).join(", ")}, and ${skillList[skillList.length - 1]}`
    : skillList.join(" and ");
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return `${today}

Dear Hiring Manager,

I am writing to express my strong interest in the ${jobTitle} position at ${company}. With my background in ${skillsText}, I am confident that I would be a valuable addition to your team.

${interest ? `What particularly excites me about ${company} is ${interest.charAt(0).toLowerCase() + interest.slice(1)}${interest.endsWith(".") ? "" : "."} This aligns perfectly with my professional goals and passion for delivering meaningful results.` : `I have been following ${company}'s growth and innovation, and I am excited about the opportunity to contribute to your continued success.`}

Throughout my career, I have developed strong expertise in ${skillsText}. I am passionate about leveraging these skills to drive results and contribute to team success. I thrive in collaborative environments and am committed to continuous learning and professional growth.

I am particularly drawn to this ${jobTitle} role because it offers the opportunity to apply my skills in a meaningful way while growing alongside a talented team. I am eager to bring my experience and enthusiasm to ${company}.

I would welcome the opportunity to discuss how my background and skills would be a great fit for this position. Thank you for your time and consideration.

Sincerely,
${name || "[Your Name]"}`;
}

export default function CoverLetterGenerator() {
  const [form, setForm] = useState({ name: "", company: "", jobTitle: "", skills: "", interest: "", jobDescription: "" });
  const [letter, setLetter] = useState("");
  // "ai" or "template": the page says which, so a generic letter is never
  // passed off as a tailored one.
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { letter: written } = await api.toolCoverLetter({
        name: form.name,
        company: form.company,
        job_title: form.jobTitle,
        skills: form.skills,
        interest: form.interest,
        job_description: form.jobDescription,
      });
      setLetter(written);
      setSource("ai");
    } catch {
      // The AI is a bonus, not a dependency: rate limited, unconfigured or
      // down, the visitor still leaves with a letter.
      setLetter(generateLetter(form));
      setSource("template");
    } finally {
      setBusy(false);
    }
  }

  function copyLetter() {
    navigator.clipboard.writeText(letter).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "AI Cover Letter Generator",
    url: "https://job.doaide.com/tools/cover-letter-generator",
    description: "Generate a tailored, professional cover letter in seconds with AI. Fill in the role and company and copy the result.",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  const fields = [
    { key: "name", label: "Your Name", placeholder: "Jane Smith", maxLength: 100 },
    { key: "company", label: "Company Name", placeholder: "Acme Corp", required: true, maxLength: 120 },
    { key: "jobTitle", label: "Job Title", placeholder: "Senior Software Engineer", required: true, maxLength: 120 },
    { key: "skills", label: "Key Skills (comma-separated)", placeholder: "React, TypeScript, Node.js", required: true, maxLength: 500 },
    { key: "interest", label: "Why are you interested? (optional)", placeholder: "Their commitment to open source and developer tools", maxLength: 600 },
  ];
  const inputClass =
    "w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

  return (
    <PublicLayout title="Free AI Cover Letter Generator" jsonLd={jsonLd}>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-ink-900 mb-2">Cover Letter Generator</h1>
        <p className="text-ink-500 mb-6">
          Fill in the details below and AI writes a cover letter for this role. Add the job posting for a more tailored letter.
        </p>

        <form onSubmit={handleGenerate} className="space-y-4 mb-6">
          {fields.map((f) => (
            <div key={f.key}>
              <label htmlFor={`cl-${f.key}`} className="block text-xs text-ink-500 mb-1.5 uppercase tracking-wider">
                {f.label}
              </label>
              <input
                id={`cl-${f.key}`}
                type="text"
                value={form[f.key]}
                onChange={(e) => update(f.key, e.target.value)}
                required={f.required}
                maxLength={f.maxLength}
                placeholder={f.placeholder}
                className={inputClass}
              />
            </div>
          ))}
          <div>
            <label htmlFor="cl-jobDescription" className="block text-xs text-ink-500 mb-1.5 uppercase tracking-wider">
              Job posting (optional)
            </label>
            <textarea
              id="cl-jobDescription"
              value={form.jobDescription}
              onChange={(e) => update("jobDescription", e.target.value)}
              maxLength={6000}
              rows={5}
              placeholder="Paste the job description here"
              className={`${inputClass} resize-y`}
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary cursor-pointer disabled:opacity-60">
            {busy ? "Writing your letter…" : "Generate Cover Letter"}
          </button>
        </form>

        {letter && (
          <div className="rounded-xl border border-line bg-paper p-6" aria-live="polite">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink-900">Your Cover Letter</h2>
                <p className="text-xs text-ink-400">
                  {source === "ai"
                    ? "Written by AI — read it through and make it yours before sending."
                    : "AI is busy right now, so this one is from our template. Try again in a minute for an AI-written letter."}
                </p>
              </div>
              <button
                type="button"
                onClick={copyLetter}
                className="rounded-lg bg-brand-50 px-4 py-1.5 text-xs font-medium text-brand-500 cursor-pointer border-0 shrink-0"
              >
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700 font-sans">{letter}</pre>
          </div>
        )}

        <div className="mt-8">
          <ShareButtons url="https://job.doaide.com/tools/cover-letter-generator" title="Free AI Cover Letter Generator by DoAide" />
        </div>
      </div>
    </PublicLayout>
  );
}
