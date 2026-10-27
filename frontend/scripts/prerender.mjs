// Post-build: give every public route its own index.html with the right head,
// and write sitemap.xml from the same list.
//
// The production static server answers a directory with its index.html, so
// dist/tools/resume-score/index.html is what /tools/resume-score serves. Each
// carries its own title, description, canonical, social tags and JSON-LD, plus
// an h1 in #root — everything a crawler or a link unfurler reads before (or
// instead of) running the JavaScript.
//
//   node scripts/prerender.mjs [distDir]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildSitemap, renderBody, renderHead } from "../src/seo/head.js";
import { PUBLIC_ROUTES, SERVER_PAGES, SITE_URL } from "../src/seo/routes.js";

const dist = resolve(process.argv[2] ?? "dist");
const template = await readFile(join(dist, "index.html"), "utf8");

for (const route of PUBLIC_ROUTES) {
  const html = renderBody(renderHead(template, route), route);
  const dir = route.path === "/" ? dist : join(dist, route.path);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), html);
}

await writeFile(join(dist, "sitemap.xml"), buildSitemap([...PUBLIC_ROUTES, ...SERVER_PAGES], SITE_URL));
console.log(`prerender: ${PUBLIC_ROUTES.length} route heads + sitemap.xml written to ${dist}`);
