import { Link } from "react-router-dom";
import PublicLayout from "../components/PublicLayout";

/**
 * Unknown URLs used to bounce to "/" — which told a mistyped link nothing and
 * told Google every dead URL was the homepage. This says what happened, offers
 * the likely destinations, and is marked noindex.
 */
export default function NotFound() {
  return (
    <PublicLayout title="Page not found" noindex>
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-3xl font-bold text-ink-900">This page doesn't exist</h1>
        <p className="mt-3 text-ink-500">
          The link may be old or mistyped. Here are some places to go instead.
        </p>
        <nav className="mt-8 flex flex-wrap justify-center gap-3 text-sm" aria-label="Suggested pages">
          <Link to="/" className="btn-primary no-underline">
            Home
          </Link>
          <Link to="/tools" className="rounded-lg border border-line px-4 py-2 text-ink-700 no-underline hover:border-brand-500">
            Free tools
          </Link>
          <Link to="/blog" className="rounded-lg border border-line px-4 py-2 text-ink-700 no-underline hover:border-brand-500">
            Blog
          </Link>
        </nav>
      </div>
    </PublicLayout>
  );
}
