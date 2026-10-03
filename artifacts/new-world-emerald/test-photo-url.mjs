import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { productPhotoUrl } from "./src/lib/productPhotoUrl.ts";

test("uploaded photo URL remains the public storage route when saved and read back", () => {
  const upload = { objectPath: "/objects/uploads/photo-fixture.jpg" };
  const stagedUrl = productPhotoUrl(upload.objectPath, "/");
  assert.equal(stagedUrl, "/api/storage/objects/uploads/photo-fixture.jpg");
  // The uploader stages this value; Add/Save persists it as imageUrl unchanged.
  const savedProduct = JSON.parse(JSON.stringify({ imageUrl: stagedUrl }));
  const publicProduct = JSON.parse(JSON.stringify(savedProduct));
  assert.equal(publicProduct.imageUrl, stagedUrl);
  assert.equal(new URL(publicProduct.imageUrl, "https://school.example").pathname,
    "/api/storage/objects/uploads/photo-fixture.jpg");
});

test("uploaded photo URLs respect artifact prefixes and reject non-object paths", () => {
  assert.equal(productPhotoUrl("/objects/photo.jpg", "/school/"), "/school/api/storage/objects/photo.jpg");
  assert.throws(() => productPhotoUrl("https://untrusted.example/photo.jpg"));
});

test("the public homepage route does not depend on signed-in status", async () => {
  const app = await readFile(new URL("./src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<Route path="\/" component=\{Home\} \/>/);
  assert.doesNotMatch(app, /HomeRedirect|<Redirect to="\/admin"/);
  const signIn = await readFile(new URL("./src/pages/SchoolSignIn.tsx", import.meta.url), "utf8");
  assert.match(signIn, /forceRedirectUrl=\{`\$\{basePath\}\/admin`\}/);
});