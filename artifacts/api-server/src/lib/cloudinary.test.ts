import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudinaryCredentials, cloudinaryReady, publicIdFor, resourceTypeFor, signUploadGrant, verifyUploadGrant } from "./cloudinary";

const FAKE = "cloudinary://123456789012345:fake-secret-for-tests@demo-school";

test("reads CLOUDINARY_URL and rejects anything else", () => {
  assert.deepEqual(cloudinaryCredentials(FAKE), { apiKey: "123456789012345", apiSecret: "fake-secret-for-tests", cloudName: "demo-school" });
  assert.equal(cloudinaryCredentials("CLOUDINARY_URL=" + FAKE), null, "a pasted NAME= prefix is not accepted");
  assert.equal(cloudinaryCredentials("https://demo-school.cloudinary.com"), null);
  assert.equal(cloudinaryCredentials(undefined), null);
  const saved = process.env.CLOUDINARY_URL;
  delete process.env.CLOUDINARY_URL;
  assert.equal(cloudinaryReady(), false);
  process.env.CLOUDINARY_URL = FAKE;
  assert.equal(cloudinaryReady(), true);
  if (saved === undefined) delete process.env.CLOUDINARY_URL; else process.env.CLOUDINARY_URL = saved;
});

test("chooses how each file type is stored", () => {
  assert.equal(resourceTypeFor("image/jpeg"), "image");
  assert.equal(resourceTypeFor("video/mp4"), "video");
  assert.equal(resourceTypeFor("application/pdf"), "raw");
  assert.equal(resourceTypeFor("image/svg+xml"), "raw", "SVG is kept as a plain file, not processed as a photo");
  assert.equal(publicIdFor("nwe/site", "abc", "application/pdf"), "nwe/site/abc.pdf");
  assert.equal(publicIdFor("nwe/site", "abc", "image/png"), "nwe/site/abc");
});

test("upload links are signed, expire and cannot be altered", () => {
  const saved = process.env.CLOUDINARY_URL;
  process.env.CLOUDINARY_URL = FAKE;
  try {
    const grant = { id: "11111111-2222-3333-4444-555555555555", contentType: "video/mp4", size: 1000, expires: Date.now() + 60_000 };
    const token = signUploadGrant(grant);
    assert.deepEqual(verifyUploadGrant(token), grant);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...grant, size: 10 ** 9 })).toString("base64url");
    assert.equal(verifyUploadGrant(`${forged}.${sig}`), null, "changing the size breaks the signature");
    assert.equal(verifyUploadGrant(`${payload}.AAAA`), null);
    assert.equal(verifyUploadGrant("garbage"), null);
    assert.equal(verifyUploadGrant(token, grant.expires + 1), null, "expired");
    process.env.CLOUDINARY_URL = FAKE.replace("fake-secret", "other-secret");
    assert.equal(verifyUploadGrant(token), null, "a different secret rejects old links");
  } finally {
    if (saved === undefined) delete process.env.CLOUDINARY_URL; else process.env.CLOUDINARY_URL = saved;
  }
});
