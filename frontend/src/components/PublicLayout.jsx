import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Logo from "./ui/Logo";
import ThemeToggle from "./ThemeToggle";
import { applyMeta } from "../seo/head";
import { HOME_META, metaFor } from "../seo/routes";

export default function PublicLayout({ title, description, jsonLd, noindex = false, children }) {
  const { pathname } = useLocation();

  // A known route takes its head from seo/routes — the same values the build
  // baked into its HTML, so the rendered page and the crawled one agree. Pages
  // with no entry (an unknown article, the 404) fall back to their props and
  // are kept out of the index.
  useEffect(() => {
    const route = noindex ? null : metaFor(pathname.replace(/(.)\/+$/, "$1"));
    applyMeta({
      path: route?.path ?? null,
      title: route?.title ?? title,
      description: route?.description ?? description ?? HOME_META.description,
      ogType: route?.ogType,
      noindex: noindex || !route,
    });
    return () => applyMeta(HOME_META);
  }, [pathname, title, description, noindex]);

  useEffect(() => {
    if (!jsonLd) return;
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);
    return () => script.remove();
  }, [jsonLd]);

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink-700">
      <header className="border-b border-line">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 no-underline">
            <Logo className="h-7 w-7 text-brand-500" />
            <span className="text-lg font-semibold text-ink-900">
              DoAide <span className="text-ink-400">|</span> <span className="text-brand-500">AutoApply</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/tools" className="text-ink-500 hover:text-ink-900 transition-colors no-underline">Tools</Link>
            <Link to="/blog" className="text-ink-500 hover:text-ink-900 transition-colors no-underline">Blog</Link>
            <ThemeToggle className="hidden sm:inline-flex" />
            <Link to="/" className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-medium text-white no-underline hover:bg-brand-600 transition-colors">
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 py-8">
          {children}
        </div>
      </main>

      <div className="border-t border-line bg-brand-50">
        <div className="mx-auto max-w-5xl px-4 py-8 text-center">
          <h3 className="text-xl font-bold text-ink-900 mb-2">Ready to automate your job search?</h3>
          <p className="text-ink-500 mb-4 text-sm">AI finds, matches, and applies to jobs for you.</p>
          <Link to="/" className="inline-block rounded-lg bg-brand-500 px-6 py-2.5 font-medium text-white no-underline hover:bg-brand-600 transition-colors">
            Start Free
          </Link>
        </div>
      </div>

      <footer className="border-t border-line py-6">
        <div className="mx-auto max-w-5xl px-4 flex items-center justify-between text-xs text-ink-400">
          <div className="flex items-center gap-2">
            <Logo className="h-4 w-4 text-brand-500" />
            <a href="https://doaide.com" className="hover:text-brand-500 transition-colors no-underline text-ink-400" target="_blank" rel="noopener noreferrer">doaide.com</a>
            <span className="mx-1">&middot;</span>
            <a href="https://doaide.com" className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-400 no-underline transition-colors hover:border-brand-500 hover:text-brand-500" target="_blank" rel="noopener noreferrer">
              A DoAide Product
            </a>
          </div>
          <span>&copy; {new Date().getFullYear()} DoAide</span>
        </div>
      </footer>
    </div>
  );
}
