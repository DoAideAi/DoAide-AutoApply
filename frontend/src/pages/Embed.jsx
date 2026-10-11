import { useState } from "react";
import PublicLayout from "../components/PublicLayout";

const TOOLS = [
  { id: "resume-score", label: "ATS Resume Score Checker", path: "/tools/resume-score" },
  { id: "salary-estimator", label: "Tech Salary Estimator", path: "/tools/salary-estimator" },
  { id: "cover-letter-generator", label: "Cover Letter Generator", path: "/tools/cover-letter-generator" },
];

export default function Embed() {
  const [tool, setTool] = useState(TOOLS[0].id);
  const [width, setWidth] = useState("100%");
  const [height, setHeight] = useState("600");
  const [copied, setCopied] = useState(false);

  const selected = TOOLS.find((t) => t.id === tool);
  const src = `https://job.doaide.com${selected.path}`;
  const code = `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" style="border:none;border-radius:12px;" title="${selected.label}"></iframe>`;

  function copyCode() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <PublicLayout title="Embed Our Tools">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-ink-900 mb-2">Embed Our Tools</h1>
        <p className="text-ink-500 mb-6">Add our free job search tools to your website, blog, or career portal.</p>

        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-xs text-ink-500 mb-1.5 uppercase tracking-wider">Tool</label>
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {TOOLS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-500 mb-1.5 uppercase tracking-wider">Width</label>
            <input
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              placeholder="100%"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-500 mb-1.5 uppercase tracking-wider">Height</label>
            <input
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="600"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
        </div>

        <div className="rounded-xl border border-line bg-paper p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-ink-500 uppercase tracking-wider">Embed Code</span>
            <button
              onClick={copyCode}
              className="rounded-lg bg-brand-50 px-3 py-1 text-xs font-medium text-brand-500 cursor-pointer border-0"
            >
              {copied ? "Copied!" : "Copy Code"}
            </button>
          </div>
          <pre className="text-xs text-ink-500 overflow-x-auto whitespace-pre-wrap break-all font-mono">{code}</pre>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-ink-900 mb-3">Preview</h2>
          <div className="rounded-xl overflow-hidden border border-line">
            <iframe
              src={selected.path}
              width={width}
              height={height}
              style={{ border: "none", maxWidth: "100%", display: "block" }}
              title={selected.label}
            />
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
