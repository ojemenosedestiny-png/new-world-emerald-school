import { test } from "node:test";
import assert from "node:assert/strict";
import { parseByteRange } from "./byte-range";

test("media byte ranges support full requests, Safari probes, seeking and suffixes", () => {
  assert.equal(parseByteRange(undefined, 100), null);
  assert.deepEqual(parseByteRange("bytes=0-1", 100), { start: 0, end: 1 });
  assert.deepEqual(parseByteRange("bytes=20-", 100), { start: 20, end: 99 });
  assert.deepEqual(parseByteRange("bytes=20-40", 100), { start: 20, end: 40 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-200", 100), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=90-200", 100), { start: 90, end: 99 });
});

test("invalid and out-of-bounds media requests are rejected", () => {
  for (const value of ["bytes=100-", "bytes=50-40", "bytes=-0", "bytes=-", "bytes=0-1,20-30", "bytes=abc", "bytes=999999999999999999999-"]) {
    assert.equal(parseByteRange(value, 100), "invalid", value);
  }
  assert.equal(parseByteRange("bytes=0-1", 0), "invalid");
});