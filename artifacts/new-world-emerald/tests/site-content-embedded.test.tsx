import { describe, expect, it } from "vitest";
import { readEmbeddedSiteContent } from "../src/lib/siteContent";

const page = (body: string) => new DOMParser().parseFromString(`<!doctype html><html><head>${body}</head><body></body></html>`, "text/html");

describe("content embedded in the page", () => {
  it("reads the school's edits that the server put into the page", () => {
    const doc = page(`<script type="application/json" id="nwe-site-content">{"revision":3,"values":{"hero.image":"/objects/uploads/new","hero.title":"Welcome \u003cb\u003e"}}</script>`);
    expect(readEmbeddedSiteContent(doc)).toEqual({ "hero.image": "/objects/uploads/new", "hero.title": "Welcome <b>" });
  });
  it("falls back to the built-in defaults when there is nothing usable", () => {
    expect(readEmbeddedSiteContent(page(""))).toEqual({});
    expect(readEmbeddedSiteContent(page(`<script type="application/json" id="nwe-site-content">{broken</script>`))).toEqual({});
    expect(readEmbeddedSiteContent(undefined)).toEqual({});
  });
});
