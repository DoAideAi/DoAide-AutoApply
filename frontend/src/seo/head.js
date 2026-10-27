// Head tags for one page, applied two ways: to the live document on client-side
// navigation (applyMeta) and to the built index.html string at build time
// (renderHead). Both write the same set, so what a crawler reads in the HTML and
// what the rendered page says agree.
import { PUBLISHER, SITE_NAME, canonicalUrl, fullTitle } from "./routes.js";

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The tag values for a page, keyed by the selector that finds each in <head>. */
export function headTags({ path, title, description, ogType = "website", noindex = false }) {
  const t = fullTitle(title);
  const tags = {
    'meta[name="description"]': { name: "description", content: description },
    'meta[property="og:type"]': { property: "og:type", content: ogType },
    'meta[property="og:title"]': { property: "og:title", content: t },
    'meta[property="og:description"]': { property: "og:description", content: description },
    'meta[name="twitter:title"]': { name: "twitter:title", content: t },
    'meta[name="twitter:description"]': { name: "twitter:description", content: description },
    'meta[name="robots"]': { name: "robots", content: noindex ? "noindex" : "index,follow" },
  };
  if (path) {
    tags['meta[property="og:url"]'] = { property: "og:url", content: canonicalUrl(path) };
  }
  return { title: t, canonical: path ? canonicalUrl(path) : null, tags };
}

/** Point the live document's head at *meta*. Missing tags are created. */
export function applyMeta(meta, doc = document) {
  const { title, canonical, tags } = headTags(meta);
  doc.title = title;
  for (const [selector, attrs] of Object.entries(tags)) {
    if (attrs.content == null) continue;
    let el = doc.head.querySelector(selector);
    if (!el) {
      el = doc.createElement("meta");
      if (attrs.name) el.setAttribute("name", attrs.name);
      if (attrs.property) el.setAttribute("property", attrs.property);
      doc.head.appendChild(el);
    }
    el.setAttribute("content", attrs.content);
  }
  // The prerendered page's JSON-LD describes the URL it was built for, not the
  // one navigated to.
  doc.head.querySelectorAll("script[data-page-ld]").forEach((el) => el.remove());
  let link = doc.head.querySelector('link[rel="canonical"]');
  if (canonical) {
    if (!link) {
      link = doc.createElement("link");
      link.setAttribute("rel", "canonical");
      doc.head.appendChild(link);
    }
    link.setAttribute("href", canonical);
  } else if (link) {
    link.remove();
  }
}

function tagHtml(attrs) {
  const key = attrs.name ? `name="${attrs.name}"` : `property="${attrs.property}"`;
  return `<meta ${key} content="${escapeAttr(attrs.content)}" />`;
}

/**
 * Rewrite the built index.html for *meta*: the title, the canonical, and every
 * tag headTags names. Tags the template already carries are replaced in place;
 * the rest go in before </head>.
 */
export function renderHead(html, meta) {
  const { title, canonical, tags } = headTags(meta);
  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(title)}</title>`);

  const missing = [];
  for (const attrs of Object.values(tags)) {
    if (attrs.content == null) continue;
    const key = attrs.name ? `name="${attrs.name}"` : `property="${attrs.property}"`;
    const re = new RegExp(`<meta\\s+${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?\\/?>`);
    if (re.test(out)) out = out.replace(re, tagHtml(attrs));
    else missing.push(tagHtml(attrs));
  }

  const canonicalRe = /<link\s+rel="canonical"[\s\S]*?\/?>/;
  if (canonical) {
    const link = `<link rel="canonical" href="${escapeAttr(canonical)}" />`;
    if (canonicalRe.test(out)) out = out.replace(canonicalRe, link);
    else missing.push(link);
  } else {
    out = out.replace(canonicalRe, "");
  }

  if (missing.length) out = out.replace("</head>", `    ${missing.join("\n    ")}\n  </head>`);
  return out;
}

/** Schema.org data for one page: an Article for blog posts, a WebPage otherwise. */
export function pageJsonLd({ path, title, description, ogType, lastmod }) {
  const url = canonicalUrl(path);
  if (ogType === "article") {
    return {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description,
      url,
      mainEntityOfPage: url,
      ...(lastmod ? { datePublished: lastmod, dateModified: lastmod } : {}),
      author: PUBLISHER,
      publisher: PUBLISHER,
    };
  }
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: fullTitle(title),
    description,
    url,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: canonicalUrl("/") },
    publisher: PUBLISHER,
  };
}

/**
 * Add the page's JSON-LD to <head> and its heading and description to the empty
 * #root, so the HTML carries an h1 before the JavaScript runs. createRoot
 * replaces the contents of #root on mount.
 */
export function renderBody(html, meta) {
  const ld = JSON.stringify(pageJsonLd(meta)).replace(/</g, "\\u003c");
  const heading = meta.heading ?? meta.title;
  return html
    .replace("</head>", `  <script type="application/ld+json" data-page-ld>${ld}</script>\n  </head>`)
    .replace(
      '<div id="root"></div>',
      `<div id="root"><main><h1>${escapeAttr(heading)}</h1><p>${escapeAttr(meta.description)}</p></main></div>`,
    );
}

export function buildSitemap(routes, siteUrl) {
  const urls = routes
    .map((r) => {
      const loc = r.path === "/" ? `${siteUrl}/` : `${siteUrl}${r.path}`;
      const lines = [`    <loc>${loc}</loc>`];
      if (r.lastmod) lines.push(`    <lastmod>${r.lastmod}</lastmod>`);
      if (r.changefreq) lines.push(`    <changefreq>${r.changefreq}</changefreq>`);
      if (r.priority) lines.push(`    <priority>${r.priority}</priority>`);
      return `  <url>\n${lines.join("\n")}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
