import { useState } from "react";
import PublicLayout from "../../components/PublicLayout";
import ShareButtons from "../../components/ShareButtons";
import { api } from "../../lib/api";

const ACTION_VERBS = [
  "achieved","managed","led","developed","created","implemented","designed",
  "improved","increased","reduced","delivered","launched","built","negotiated",
  "coordinated","analyzed","streamlined","optimized","resolved","generated",
  "supervised","mentored","spearheaded","pioneered","transformed","accelerated",
];
const SECTIONS = ["experience","education","skills","summary","projects","certifications"];
const QUANTIFIERS = /\d+%|\$[\d,]+|\d+\+?\s*(years?|months?|clients?|projects?|people|team)/gi;

function analyze(text) {
  if (!text.trim()) return null;
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const lines = text.split("\n").filter((l) => l.trim());

  const verbHits = ACTION_VERBS.filter((v) => lower.includes(v));
  const verbScore = Math.min(verbHits.length * 4, 25);

  const quantMatches = text.match(QUANTIFIERS) || [];
  const quantScore = Math.min(quantMatches.length * 5, 20);

  const foundSections = SECTIONS.filter((s) => lower.includes(s));
  const sectionScore = Math.min(foundSections.length * 5, 20);

  const lengthWords = words.length;
  let lengthScore = 0;
  if (lengthWords >= 200 && lengthWords <= 800) lengthScore = 20;
  else if (lengthWords >= 100) lengthScore = 12;
  else if (lengthWords >= 50) lengthScore = 6;

  const hasEmail = /[\w.-]+@[\w.-]+\.\w+/.test(text);
  const hasPhone = /[\d()+-]{7,}/.test(text);
  const contactScore = (hasEmail ? 8 : 0) + (hasPhone ? 7 : 0);

  const total = Math.min(verbScore + quantScore + sectionScore + lengthScore + contactScore, 100);

  const tips = [];
  if (verbHits.length < 5) tips.push("Add more action verbs (achieved, led, implemented, optimized)");
  if (quantMatches.length < 3) tips.push("Quantify your achievements ($, %, numbers)");
  if (foundSections.length < 3) tips.push("Include standard sections: Experience, Education, Skills");
  if (lengthWords < 200) tips.push("Your resume seems short — aim for 200-800 words");
  if (lengthWords > 800) tips.push("Consider trimming — keep it concise and relevant");
  if (!hasEmail) tips.push("Include your email address");
  if (!hasPhone) tips.push("Include your phone number");

  return {
    total,
    verbScore,
    verbHits,
    quantScore,
    quantMatches: quantMatches.length,
    sectionScore,
    foundSections,
    lengthScore,
    lengthWords,
    contactScore,
    tips,
  };
}

function ScoreGauge({ score }) {
  const color = score >= 70 ? "#059669" : score >= 40 ? "#0D9488" : "#DC2626";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-32 h-32">
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="10" />
          <circle
            cx="60" cy="60" r="50" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${(score / 100) * 314} 314`}
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-3xl font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="text-sm font-medium" style={{ color }}>
        {score >= 70 ? "Strong" : score >= 40 ? "Needs Work" : "Weak"}
      </span>
    </div>
  );
}

export default function ResumeScore() {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState(null);

  function handleAnalyze() {
    setResult(analyze(text));
  }

  // Most people have a resume file, not its text on the clipboard; asking them
  // to open it and copy everything out was the step where the tool lost them.
  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileError(null);
    setReading(true);
    try {
      const { text: extracted } = await api.toolResumeText(file);
      setText(extracted);
      setResult(analyze(extracted));
    } catch (err) {
      setFileError(err.message);
    } finally {
      setReading(false);
    }
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "ATS Resume Score Checker",
    url: "https://job.doaide.com/tools/resume-score",
    description: "Free ATS resume compatibility checker. Upload or paste your resume and get an instant score with actionable tips.",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return (
    <PublicLayout title="Free ATS Resume Score Checker" jsonLd={jsonLd}>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-ink-900 mb-2">ATS Resume Score Checker</h1>
        <p className="text-ink-500 mb-6">Upload your resume or paste its text below and get an instant ATS compatibility score with actionable tips.</p>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label
            htmlFor="resume-file"
            className={`btn-primary cursor-pointer ${reading ? "pointer-events-none opacity-60" : ""}`}
          >
            {reading ? "Reading your resume…" : "Upload PDF or DOCX"}
          </label>
          <input
            id="resume-file"
            type="file"
            accept=".pdf,.docx"
            onChange={handleFile}
            disabled={reading}
            className="sr-only"
          />
          <span className="text-xs text-ink-400">Up to 5 MB. Not stored. Or paste the text below.</span>
        </div>
        {fileError && (
          <p role="alert" className="mb-4 text-sm text-bad">
            {fileError}
          </p>
        )}

        <textarea
          aria-label="Resume text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="Paste your resume text here..."
          className="w-full rounded-xl border border-line bg-canvas p-4 text-sm text-ink-900 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          style={{ caretColor: "#0D9488" }}
        />

        <button
          onClick={handleAnalyze}
          disabled={!text.trim()}
          className="btn-primary mt-4 cursor-pointer disabled:opacity-40"
        >
          Analyze Resume
        </button>

        {result && (
          <div className="mt-8 rounded-xl border border-line bg-paper p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 mb-6">
              <ScoreGauge score={result.total} />
              <div className="flex-1 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-canvas p-3">
                  <div className="text-ink-500 text-xs mb-1">Action Verbs</div>
                  <div className="text-ink-900 font-medium">{result.verbScore}/25</div>
                </div>
                <div className="rounded-lg bg-canvas p-3">
                  <div className="text-ink-500 text-xs mb-1">Quantified Results</div>
                  <div className="text-ink-900 font-medium">{result.quantScore}/20</div>
                </div>
                <div className="rounded-lg bg-canvas p-3">
                  <div className="text-ink-500 text-xs mb-1">Sections</div>
                  <div className="text-ink-900 font-medium">{result.sectionScore}/20</div>
                </div>
                <div className="rounded-lg bg-canvas p-3">
                  <div className="text-ink-500 text-xs mb-1">Length ({result.lengthWords} words)</div>
                  <div className="text-ink-900 font-medium">{result.lengthScore}/20</div>
                </div>
              </div>
            </div>

            {result.tips.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-ink-900 mb-2">Tips to Improve</h3>
                <ul className="space-y-1.5">
                  {result.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink-500">
                      <span className="text-brand-500">&#x2022;</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="mt-8">
          <ShareButtons url="https://job.doaide.com/tools/resume-score" title="Free ATS Resume Score Checker by DoAide" />
        </div>
      </div>
    </PublicLayout>
  );
}
