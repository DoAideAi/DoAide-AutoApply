import { Link } from "react-router-dom";
import PublicLayout from "../../components/PublicLayout";
import { ARTICLES } from "./articles";

export default function BlogIndex() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "DoAide Jobs Blog",
    url: "https://job.doaide.com/blog",
    description: "Career tips, job search strategies, and AI-powered hiring insights.",
  };

  return (
    <PublicLayout title="Blog" jsonLd={jsonLd}>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-ink-900 mb-2">Blog</h1>
        <p className="text-ink-500 mb-8">Career tips, job search strategies, and AI-powered hiring insights.</p>

        <div className="space-y-4">
          {ARTICLES.map((article) => (
            <Link
              key={article.slug}
              to={`/blog/${article.slug}`}
              className="block rounded-xl border border-line bg-paper p-5 transition-colors no-underline group"
            >
              <div className="flex items-center gap-3 text-xs text-ink-400 mb-2">
                <time>{new Date(article.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</time>
                <span>&middot;</span>
                <span>{article.readTime}</span>
              </div>
              <h2 className="text-lg font-semibold text-ink-900 mb-1.5 group-hover:text-brand-500 transition-colors">{article.title}</h2>
              <p className="text-sm text-ink-500">{article.excerpt}</p>
            </Link>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
