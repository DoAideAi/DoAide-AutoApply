// The public, crawlable pages and what a search result should say about each.
//
// One list, read three ways: PublicLayout sets these on client-side navigation,
// scripts/prerender.mjs bakes them into a per-route index.html at build time
// (crawlers and link unfurlers read the HTML, and the SPA shell otherwise gives
// every URL the homepage's title and canonical), and the same script writes
// sitemap.xml from it, so a new article cannot be published and left out.
import { ARTICLES } from "../pages/blog/articles.js";

export const SITE_URL = "https://job.doaide.com";
export const SITE_NAME = "DoAide AutoApply";

export const HOME_META = {
  path: "/",
  title: "DoAide AutoApply — AI Job Application Platform",
  description:
    "Upload your resume, DoAide AutoApply finds recruiters and writes the emails. AI-powered job application automation that gets results.",
  changefreq: "weekly",
  priority: "1.0",
};

const PAGES = [
  HOME_META,
  {
    path: "/tools",
    title: "Free Job Search Tools",
    description:
      "Free career tools: ATS resume checker, salary estimator, and AI cover letter generator. No signup needed.",
    changefreq: "monthly",
    priority: "0.9",
  },
  {
    path: "/tools/resume-score",
    title: "Free ATS Resume Score Checker",
    description:
      "Upload or paste your resume and get an instant ATS compatibility score with actionable tips. Free, no signup.",
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    path: "/tools/salary-estimator",
    title: "Free Tech Salary Estimator",
    description:
      "Estimate salary ranges for top tech roles by location and experience level, in INR and USD.",
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    path: "/tools/cover-letter-generator",
    title: "Free AI Cover Letter Generator",
    description:
      "Generate a tailored, professional cover letter in seconds with AI. Fill in the role and company and copy the result.",
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    path: "/embed",
    title: "Embed Our Tools",
    description: "Add DoAide's free resume score and salary tools to your own site with one iframe.",
    changefreq: "monthly",
    priority: "0.5",
  },
  {
    path: "/blog",
    title: "Blog",
    description: "Career tips, job search strategies, and AI-powered hiring insights for job seekers.",
    changefreq: "weekly",
    priority: "0.8",
  },
];

export const PUBLIC_ROUTES = [
  ...PAGES,
  ...ARTICLES.map((a) => ({
    path: `/blog/${a.slug}`,
    title: a.title,
    description: a.excerpt,
    lastmod: a.date,
    changefreq: "monthly",
    priority: "0.7",
    ogType: "article",
  })),
];

export function metaFor(path) {
  return PUBLIC_ROUTES.find((r) => r.path === path) ?? null;
}

/** "Free ATS Resume Score Checker | DoAide AutoApply"; the homepage title stands alone. */
export function fullTitle(title) {
  if (!title) return SITE_NAME;
  return title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
}

export function canonicalUrl(path) {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path.replace(/\/+$/, "")}`;
}
