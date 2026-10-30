import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pageSeo, robotsTxt, schoolStructuredData, siteOrigin, sitemapXml, withPageSeo } from "./seo";

const origin = "https://school.example";
const shell = readFileSync(join(process.cwd(), "../new-world-emerald/index.html"), "utf8");

test("only the homepage and the store are public; signed-in areas are private; anything else is missing", () => {
  assert.equal(pageSeo("/").kind, "public");
  assert.equal(pageSeo("/commerce/").kind, "public");
  for (const p of ["/admin", "/director", "/teacher", "/account", "/portal", "/portal/manage", "/portal/activate", "/portal/exam/12", "/sign-in", "/sign-in/factor-one", "/sign-up/verify"]) {
    assert.equal(pageSeo(p).kind, "private", p);
  }
  for (const p of ["/ijmb", "/university", "/portal/exam", "/admin/x", "/robots"]) assert.equal(pageSeo(p).kind, "missing", p);
});

test("the homepage head carries its own title, description, canonical and one School identity", () => {
  const html = withPageSeo(shell, pageSeo("/"), origin);
  assert.match(html, /<title>New World Emerald Private School \| Kubwa, Abuja<\/title>/);
  assert.match(html, /<html lang="en-NG">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/school\.example\/" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/school\.example\/" \/>/);
  assert.match(html, /<meta name="robots" content="index, follow" \/>/);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  const data = JSON.parse(blocks[0][1]);
  const school = data["@graph"].find((n: { "@type": string }) => n["@type"] === "School");
  const site = data["@graph"].find((n: { "@type": string }) => n["@type"] === "WebSite");
  assert.equal(school.name, "New World Emerald Private School");
  assert.equal(school.telephone, "+2348136037074");
  assert.equal(school.email, "info@newworldemeraldprivateschool.com");
  assert.deepEqual(school.address, { "@type": "PostalAddress", streetAddress: "Emerald Building, New World Crescent, Oyigene Audu Avenue, F01", addressLocality: "Kubwa", addressRegion: "Federal Capital Territory", addressCountry: "NG" });
  assert.equal(site.publisher["@id"], school["@id"]);
  assert.equal(site.alternateName, undefined, "the school uses its full name only");
  // Nothing unverified: no ratings, reviews or social links until the school supplies them.
  for (const key of ["aggregateRating", "review", "sameAs", "alternateName"]) assert.equal(school[key], undefined, key);
});

test("the store page has its own title and canonical and no structured data", () => {
  const html = withPageSeo(shell, pageSeo("/commerce"), origin);
  assert.match(html, /<title>Uniforms &amp; School Payments \| New World Emerald Private School<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/school\.example\/commerce" \/>/);
  assert.doesNotMatch(html, /application\/ld\+json/);
  assert.equal((html.match(/name="description"/g) ?? []).length, 1);
});

test("private and unknown addresses are noindex with no canonical", () => {
  for (const p of ["/admin", "/portal/exam/3", "/nope"]) {
    const html = withPageSeo(shell, pageSeo(p), origin);
    assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/, p);
    assert.doesNotMatch(html, /rel="canonical"|ld\+json/, p);
  }
});

test("robots.txt and the sitemap use the configured domain and list only public pages", () => {
  assert.match(robotsTxt(origin), /Sitemap: https:\/\/school\.example\/sitemap\.xml/);
  assert.match(robotsTxt(origin), /Disallow: \/api\//);
  const map = sitemapXml(origin);
  assert.deepEqual([...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), ["https://school.example/", "https://school.example/commerce"]);
  assert.doesNotMatch(map, /admin|portal|sign-in/);
});

test("the site origin falls back to the school's domain when PUBLIC_SITE_URL is missing or invalid", () => {
  assert.equal(siteOrigin(""), "https://newworldemeraldprivateschool.com");
  assert.equal(siteOrigin("not a url"), "https://newworldemeraldprivateschool.com");
  assert.equal(siteOrigin("https://school.example/path/"), origin);
  assert.equal(schoolStructuredData(origin)["@graph"][0]["@id"], "https://school.example/#school");
});
