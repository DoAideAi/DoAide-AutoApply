import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ARTICLES } from "../pages/blog/articles.js";
import { applyMeta, buildSitemap, pageJsonLd, renderBody, renderHead } from "./head.js";
import { HOME_META, PUBLIC_ROUTES, SITE_URL, canonicalUrl, fullTitle, metaFor } from "./routes.js";

const TEMPLATE = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

describe("routes", () => {
  it("lists every blog article", () => {
    for (const a of ARTICLES) expect(metaFor(`/blog/${a.slug}`)?.title).toBe(a.title);
  });

  it("has unique paths, each with a title and description", () => {
    const paths = PUBLIC_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const r of PUBLIC_ROUTES) {
      expect(r.title).toBeTruthy();
      expect(r.description).toBeTruthy();
    }
  });

  it("suffixes the site name once", () => {
    expect(fullTitle("Blog")).toBe("Blog | DoAide AutoApply");
    expect(fullTitle(HOME_META.title)).toBe(HOME_META.title);
  });

  it("builds canonical URLs without trailing slashes except the root", () => {
    expect(canonicalUrl("/")).toBe(`${SITE_URL}/`);
    expect(canonicalUrl("/tools/")).toBe(`${SITE_URL}/tools`);
  });
});

describe("renderHead", () => {
  const meta = metaFor("/tools/resume-score");

  it("replaces the template's title, description and canonical", () => {
    const html = renderHead(TEMPLATE, meta);
    expect(html).toContain("<title>Free ATS Resume Score Checker | DoAide AutoApply</title>");
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/tools/resume-score" />`);
    expect(html).toContain(`<meta name="description" content="${meta.description}" />`);
    expect(html).toContain(`<meta property="og:url" content="${SITE_URL}/tools/resume-score" />`);
    expect(html).not.toContain(`href="https://job.doaide.com" />`);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
  });

  it("adds tags the template lacks and keeps the app entry script", () => {
    const html = renderHead(TEMPLATE, meta);
    expect(html).toContain('<meta name="robots" content="index,follow" />');
    expect(html).toContain('src="/src/main.jsx"');
  });

  it("escapes quotes and angle brackets", () => {
    const html = renderHead(TEMPLATE, { path: "/x", title: 'A "b" <c>', description: "d & e" });
    expect(html).toContain("<title>A &quot;b&quot; &lt;c&gt; | DoAide AutoApply</title>");
    expect(html).toContain('content="d &amp; e"');
  });

  it("marks articles as og:type article", () => {
    const html = renderHead(TEMPLATE, metaFor(`/blog/${ARTICLES[0].slug}`));
    expect(html).toContain('<meta property="og:type" content="article" />');
  });
});

describe("buildSitemap", () => {
  it("includes every public route with its lastmod", () => {
    const xml = buildSitemap(PUBLIC_ROUTES, SITE_URL);
    expect(xml.match(/<url>/g)).toHaveLength(PUBLIC_ROUTES.length);
    expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
    const last = ARTICLES[ARTICLES.length - 1];
    expect(xml).toContain(`<loc>${SITE_URL}/blog/${last.slug}</loc>\n    <lastmod>${last.date}</lastmod>`);
  });
});

describe("applyMeta", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("creates missing tags and updates them on the next call", () => {
    applyMeta(metaFor("/blog"));
    expect(document.title).toBe("Blog | DoAide AutoApply");
    expect(document.head.querySelector('link[rel="canonical"]').href).toBe(`${SITE_URL}/blog`);

    applyMeta(metaFor("/tools"));
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[name="description"]').content).toBe(metaFor("/tools").description);
  });

  it("drops the canonical and sets noindex for pages without a path", () => {
    applyMeta(metaFor("/blog"));
    applyMeta({ path: null, title: "Page not found", description: "x", noindex: true });
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('meta[name="robots"]').content).toBe("noindex");
  });
});

describe("renderBody", () => {
  const shell = "<html><head><title>x</title></head><body><div id=\"root\"></div></body></html>";

  it("puts the page heading in #root and page JSON-LD in the head", () => {
    const html = renderBody(shell, metaFor("/tools/resume-score"));
    expect(html).toContain("<h1>Free ATS Resume Score Checker</h1>");
    expect(html).toMatch(/<script type="application\/ld\+json" data-page-ld>.*"@type":"WebPage".*<\/script>\n  <\/head>/);
  });

  it("uses the homepage's own heading and Article data for posts", () => {
    expect(renderBody(shell, HOME_META)).toContain("<h1>AI-powered job application platform</h1>");
    const post = PUBLIC_ROUTES.find((r) => r.ogType === "article");
    const ld = pageJsonLd(post);
    expect(ld["@type"]).toBe("Article");
    expect(ld.datePublished).toBe(post.lastmod);
  });
});
