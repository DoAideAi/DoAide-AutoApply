// node --test deploy/static-server.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// The server reads --root at import, so point it at a scratch dist first.
const root = mkdtempSync(join(tmpdir(), "autoapply-dist-"));
writeFileSync(join(root, "index.html"), "<title>shell</title>");
writeFileSync(join(root, "sitemap.xml"), "<urlset/>");
mkdirSync(join(root, "tools", "resume-score"), { recursive: true });
writeFileSync(join(root, "tools", "resume-score", "index.html"), "<title>resume score</title>");
process.argv.push("--root", root);

const { isEmbeddable, securityHeaders, server } = await import("./static-server.mjs");

let base;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("only the free tool pages are embeddable", () => {
  assert.ok(isEmbeddable("/tools/resume-score"));
  assert.ok(isEmbeddable("/tools/cover-letter-generator/"));
  assert.ok(!isEmbeddable("/tools"));
  assert.ok(!isEmbeddable("/pipeline"));
  assert.ok(!isEmbeddable("/tools/resume-score/../../pipeline"));
});

test("app pages refuse to be framed", () => {
  const h = securityHeaders("/inbox");
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.match(h["Content-Security-Policy"], /frame-ancestors 'none'/);
});

test("tool pages may be framed by any site", () => {
  const h = securityHeaders("/tools/salary-estimator");
  assert.equal(h["X-Frame-Options"], undefined);
  assert.match(h["Content-Security-Policy"], /frame-ancestors \*/);
  assert.match(h["Content-Security-Policy"], /script-src 'self' https:\/\/analytics\.doaide\.com/);
});

test("a tool directory serves its prerendered head with framing allowed", async () => {
  const res = await fetch(`${base}/tools/resume-score`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "<title>resume score</title>");
  assert.equal(res.headers.get("x-frame-options"), null);
});

test("unknown routes get the shell and stay unframeable", async () => {
  const res = await fetch(`${base}/pipeline`);
  assert.equal(await res.text(), "<title>shell</title>");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("cache-control"), "no-cache");
});

test("a missing asset is a real 404", async () => {
  const res = await fetch(`${base}/assets/missing.js`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("the sitemap is served as XML", async () => {
  const res = await fetch(`${base}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^application\/xml/);
});
