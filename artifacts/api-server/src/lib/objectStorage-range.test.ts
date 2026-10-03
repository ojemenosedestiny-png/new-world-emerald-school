import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { File } from "@google-cloud/storage";
import { ObjectStorageService } from "./objectStorage";
import type { ObjectDownload } from "./objectStorage";

async function text(download: ObjectDownload): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of download.body!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

function fixture(contentType = "video/mp4", visibility?: "public" | "private") {
  const data = Buffer.from("0123456789");
  let streams = 0;
  const file = {
    getMetadata: async () => [{
      size: String(data.length), contentType,
      metadata: visibility ? { "custom:aclPolicy": JSON.stringify({ visibility }) } : {},
    }],
    createReadStream: (range?: { start: number; end: number }) => {
      streams++;
      return Readable.from([range ? data.subarray(range.start, range.end + 1) : data]);
    },
  } as unknown as File;
  return { file, streamCount: () => streams };
}

test("video streaming returns the exact bytes and headers requested by a phone", async () => {
  const { file } = fixture();
  const service = new ObjectStorageService();
  const probe = await service.downloadObject(file, 3600, { range: "bytes=0-1" });
  assert.equal(probe.status, 206);
  assert.equal(probe.headers.get("accept-ranges"), "bytes");
  assert.equal(probe.headers.get("content-range"), "bytes 0-1/10");
  assert.equal(probe.headers.get("content-length"), "2");
  assert.equal(probe.headers.get("content-type"), "video/mp4");
  assert.equal(await text(probe), "01");
  const seek = await service.downloadObject(file, 3600, { range: "bytes=7-" });
  assert.equal(await text(seek), "789");
  const full = await service.downloadObject(file);
  assert.equal(full.status, 200);
  assert.equal(await text(full), "0123456789");
});

test("HEAD and unsatisfiable ranges do not start a file download", async () => {
  const { file, streamCount } = fixture();
  const service = new ObjectStorageService();
  const head = await service.downloadObject(file, 3600, { headOnly: true });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(head.body, null);
  const invalid = await service.downloadObject(file, 3600, { range: "bytes=10-" });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), "bytes */10");
  assert.equal(invalid.headers.get("content-length"), "0");
  assert.equal(streamCount(), 0);
});

test("images and documents retain their content type, bytes and ACL cache visibility", async () => {
  const service = new ObjectStorageService();
  for (const contentType of ["image/jpeg", "application/pdf"]) {
    for (const visibility of ["public", "private"] as const) {
      const { file } = fixture(contentType, visibility);
      const response = await service.downloadObject(file);
      assert.equal(response.headers.get("content-type"), contentType);
      assert.equal(response.headers.get("cache-control"), `${visibility}, max-age=3600`);
      assert.equal(await text(response), "0123456789");
    }
  }
});

test("disconnects before or during metadata lookup never start an upstream download", async () => {
  const { file, streamCount } = fixture();
  const service = new ObjectStorageService();
  const controller = new AbortController();
  const metadata = await file.getMetadata();
  Object.assign(file, {
    getMetadata: async () => {
      controller.abort();
      return metadata;
    },
  });
  await assert.rejects(service.downloadObject(file, 3600, { signal: controller.signal }),
    { name: "AbortError" });
  await assert.rejects(service.downloadObject(file, 3600, { signal: controller.signal }),
    { name: "AbortError" });
  assert.equal(streamCount(), 0);
});