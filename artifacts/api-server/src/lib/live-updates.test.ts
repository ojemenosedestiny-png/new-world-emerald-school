import assert from "node:assert/strict";
import { test } from "node:test";
import { isVideoPayload } from "./live-update-rules";

test("live updates accept uploaded videos up to 500 MB and YouTube links", () => {
  const MB = 1024 * 1024;
  assert.equal(isVideoPayload({ contentType: "video/mp4", fileSize: 431 * MB, objectPath: "/objects/uploads/abc" }), true);
  assert.equal(isVideoPayload({ contentType: "video/mp4", fileSize: 501 * MB, objectPath: "/objects/uploads/abc" }), false, "over 500 MB");
  assert.equal(isVideoPayload({ contentType: "image/png", fileSize: MB, objectPath: "/objects/uploads/abc" }), false);
  assert.equal(isVideoPayload({ contentType: "video/mp4", fileSize: MB, objectPath: "https://evil.example/v.mp4" }), false, "only our own uploads");
  assert.equal(isVideoPayload({ contentType: "video/youtube", fileSize: 1, objectPath: "youtube:dQw4w9WgXcQ" }), true);
  for (const path of ["youtube:short", "youtube:dQw4w9WgXcQ/extra", "youtube:<script>alert", "/objects/uploads/x"]) {
    assert.equal(isVideoPayload({ contentType: "video/youtube", fileSize: 1, objectPath: path }), false, path);
  }
});
