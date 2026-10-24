import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudinaryCredentials, cloudinaryReady, cloudinaryUrlProblem, playableVideoUrl, publicIdFor, publicUrl, resourceTypeFor, signUploadGrant, verifyUploadGrant, videoDeliveryUrl } from "./cloudinary";

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

test("explains unusable CLOUDINARY_URL values, including the dashboard placeholders", () => {
  assert.equal(cloudinaryCredentials("cloudinary://<your_api_key>:<your_api_secret>@demo-school"), null, "placeholders are not credentials");
  assert.match(cloudinaryUrlProblem("cloudinary://<your_api_key>:<your_api_secret>@demo-school")!, /placeholders/);
  assert.match(cloudinaryUrlProblem("cloudinary://123456789012345:<your_api_secret>@demo-school")!, /placeholders/);
  assert.match(cloudinaryUrlProblem("CLOUDINARY_URL=" + FAKE)!, /starts with "CLOUDINARY_URL="/);
  assert.match(cloudinaryUrlProblem("https://demo-school.cloudinary.com")!, /wrong format/);
  assert.equal(cloudinaryUrlProblem(FAKE), null);
  assert.equal(cloudinaryUrlProblem(""), null, "unset is not a problem");
});


test("photos are resized and compressed; videos get an H.264 copy that every browser plays", () => {
  const saved = process.env.CLOUDINARY_URL;
  process.env.CLOUDINARY_URL = FAKE;
  try {
    const photo = publicUrl("nwe/site/abc", "image");
    assert.match(photo, /\/image\/upload\/[^/]*c_limit[^/]*\//);
    assert.match(photo, /f_auto/);
    assert.match(photo, /q_auto/);
    assert.match(photo, /w_1920/);
    assert.doesNotMatch(publicUrl("nwe/site/abc", "video"), /vc_h264|f_auto/, "the original video is unchanged");
    const video = playableVideoUrl("nwe/site/abc");
    assert.match(video, /\/video\/upload\/q_auto,vc_h264\/.*abc\.mp4$/);
  } finally {
    if (saved === undefined) delete process.env.CLOUDINARY_URL; else process.env.CLOUDINARY_URL = saved;
  }
});

test("videos switch to the H.264 copy once it exists, asking Cloudinary to make it only once", async () => {
  const saved = process.env.CLOUDINARY_URL;
  process.env.CLOUDINARY_URL = FAKE;
  try {
    let ready = false;
    const asked: string[] = [];
    const deps = { copyExists: async () => ready, request: async (id: string) => { asked.push(id); } };
    const t0 = 1_000_000;
    const [first, firstReady] = await videoDeliveryUrl("nwe/site/vid", t0, deps);
    assert.equal(firstReady, false);
    assert.doesNotMatch(first, /vc_h264/, "the original until the copy exists");
    await videoDeliveryUrl("nwe/site/vid", t0 + 1_000, deps);
    assert.deepEqual(asked, ["nwe/site/vid"], "within a minute nothing is checked again");
    await videoDeliveryUrl("nwe/site/vid", t0 + 61_000, deps);
    assert.deepEqual(asked, ["nwe/site/vid"], "the copy is requested only once");
    ready = true;
    const [later, laterReady] = await videoDeliveryUrl("nwe/site/vid", t0 + 122_000, deps);
    assert.equal(laterReady, true);
    assert.match(later, /q_auto,vc_h264\/.*vid\.mp4$/);
    ready = false;
    assert.equal((await videoDeliveryUrl("nwe/site/vid", t0 + 999_000, deps))[1], true, "once ready, stays ready");
    const failing = { copyExists: async () => { throw new Error("offline"); }, request: async () => {} };
    assert.equal((await videoDeliveryUrl("nwe/site/other", t0, failing))[1], false, "trouble reaching Cloudinary serves the original");
  } finally {
    if (saved === undefined) delete process.env.CLOUDINARY_URL; else process.env.CLOUDINARY_URL = saved;
  }
});
