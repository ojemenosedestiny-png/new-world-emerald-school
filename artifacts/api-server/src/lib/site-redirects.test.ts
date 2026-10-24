import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyRedirect, primaryHostRedirect } from "./site-redirects";

test("old WordPress addresses go to their new place", () => {
  assert.equal(legacyRedirect("/about-us/"), "/#about");
  assert.equal(legacyRedirect("/About-Us"), "/#about", "case and trailing slash do not matter");
  assert.equal(legacyRedirect("/faqs/"), "/#admissions");
  assert.equal(legacyRedirect("/shop/"), "/commerce");
  assert.equal(legacyRedirect("/my-account/"), "/portal");
  assert.equal(legacyRedirect("/category/learning/"), "/#news");
  assert.equal(legacyRedirect("/a-guide-for-teachers-and-education-staff/"), "/#news");
  assert.equal(legacyRedirect("/lp-home-v3/"), "/");
  assert.equal(legacyRedirect("/wp-login.php"), "/");
  assert.equal(legacyRedirect("/wp-content/uploads/2024/01/logo.png"), "/");
});

test("the new site's own pages are never redirected", () => {
  for (const path of ["/", "/admin", "/portal", "/portal/manage", "/portal/exam/3", "/portal/activate", "/commerce", "/account", "/sign-in", "/sign-in/factor-one", "/sign-up", "/assets/index.js", "/logo.jpg", "/robots.txt", "/no-such-page"]) {
    assert.equal(legacyRedirect(path), null, path);
  }
});

test("the Render address forwards to the school domain only when switched on", () => {
  const site = "https://newworldemeraldprivateschool.com";
  const render = "new-world-emerald-school.onrender.com";
  assert.equal(primaryHostRedirect(render, "/portal?x=1", site, false), null, "off by default, even with PUBLIC_SITE_URL set");
  assert.equal(primaryHostRedirect(render, "/portal?x=1", site, true), `${site}/portal?x=1`);
  assert.equal(primaryHostRedirect("newworldemeraldprivateschool.com", "/", site, true), null);
  assert.equal(primaryHostRedirect(render, "/", undefined, true), null, "needs PUBLIC_SITE_URL");
  assert.equal(primaryHostRedirect(render, "/", `https://${render}`, true), null, "no loop when the Render address is the public one");
  assert.equal(primaryHostRedirect("localhost:10123", "/", site, true), null, "local testing is untouched");
  assert.equal(primaryHostRedirect(render, "/", "not a url", true), null);
});
