import { describe, expect, it, vi } from "vitest";
import { parseYouTubeId, youTubeEmbedUrl, youTubeIdFromPath } from "../src/lib/videoSources";
import { isNetworkError, uploadVideoDirect } from "../src/lib/directUpload";

const api = vi.hoisted(() => ({
  start: vi.fn(),
  sign: vi.fn(),
  complete: vi.fn(),
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  startDirectUpload: api.start,
  signDirectUploadChunk: api.sign,
  completeDirectUpload: api.complete,
}));

describe("YouTube links", () => {
  it("reads the video id from every usual link shape", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "dQw4w9WgXcQ",
    ]) expect(parseYouTubeId(link), link).toBe("dQw4w9WgXcQ");
    for (const bad of ["", "https://vimeo.com/123", "https://youtube.com/watch?v=short", "https://evil.example/watch?v=dQw4w9WgXcQ", "not a link"]) {
      expect(parseYouTubeId(bad), bad).toBeNull();
    }
  });
  it("stores and embeds YouTube videos without tracking cookies", () => {
    expect(youTubeIdFromPath("youtube:dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeIdFromPath("/objects/uploads/abc")).toBeNull();
    expect(youTubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  });
});

describe("big video uploads straight to Cloudinary", () => {
  const file = new File([new Uint8Array(25)], "sports.mp4", { type: "video/mp4" });
  const setup = () => {
    api.start.mockResolvedValue({ token: "grant", objectPath: "/objects/uploads/xyz", uploadUrl: "https://api.cloudinary.com/v1_1/demo/video/upload", chunkSize: 10 });
    let n = 0;
    api.sign.mockImplementation(async () => ({ apiKey: "123", timestamp: 1000 + n++, signature: "sig" + n, publicId: "nwe/site/xyz" }));
    api.complete.mockResolvedValue({ objectPath: "/objects/uploads/xyz", bytes: 25 });
  };

  it("sends signed pieces with byte ranges, then records the video", async () => {
    setup();
    const calls: { range: string; id: string; form: FormData }[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ range: headers["Content-Range"], id: headers["X-Unique-Upload-Id"], form: init.body as FormData });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const progress: number[] = [];
    const path = await uploadVideoDirect(file, (f) => progress.push(f), fake);
    expect(path).toBe("/objects/uploads/xyz");
    expect(calls.map((c) => c.range)).toEqual(["bytes 0-9/25", "bytes 10-19/25", "bytes 20-24/25"]);
    expect(new Set(calls.map((c) => c.id)).size).toBe(1);
    expect(calls.map((c) => c.form.get("timestamp"))).toEqual(["1000", "1001", "1002"]);
    expect(calls[0].form.get("public_id")).toBe("nwe/site/xyz");
    expect(progress).toEqual([0.4, 0.8, 1]);
    expect(api.start).toHaveBeenCalledWith({ name: "sports.mp4", size: 25, contentType: "video/mp4" });
    expect(api.complete).toHaveBeenCalledWith({ token: "grant" });
  });

  it("retries a dropped piece, and explains Cloudinary's size limit", async () => {
    setup();
    let attempts = 0;
    const flaky = (async () => { attempts++; if (attempts === 1) throw new TypeError("network"); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    vi.useFakeTimers();
    const run = uploadVideoDirect(file, () => {}, flaky);
    await vi.runAllTimersAsync();
    await expect(run).resolves.toBe("/objects/uploads/xyz");
    vi.useRealTimers();
    expect(attempts).toBe(4);

    setup();
    const refused = (async () => new Response(JSON.stringify({ error: { message: "File size too large. Got 431000000. Maximum is 104857600." } }), { status: 400 })) as unknown as typeof fetch;
    await expect(uploadVideoDirect(file, () => {}, refused)).rejects.toThrow(/paste a YouTube link instead/);
    expect(api.complete).toHaveBeenCalledTimes(1);
  });

  it("rides out a dropped signing request and a video Cloudinary is still finishing", async () => {
    setup();
    api.sign.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    api.complete.mockReset();
    api.complete.mockRejectedValueOnce(Object.assign(new Error("not finished"), { status: 409 })).mockResolvedValue({ objectPath: "/objects/uploads/xyz", bytes: 25 });
    const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    vi.useFakeTimers();
    const run = uploadVideoDirect(file, () => {}, ok);
    await vi.runAllTimersAsync();
    await expect(run).resolves.toBe("/objects/uploads/xyz");
    vi.useRealTimers();
    expect(api.complete).toHaveBeenCalledTimes(2);
  });

  it("gives up quickly when Cloudinary is not set up, and explains a lost connection", async () => {
    setup();
    api.start.mockReset();
    api.start.mockRejectedValue(Object.assign(new Error("Big video uploads need Cloudinary"), { status: 503 }));
    await expect(uploadVideoDirect(file, () => {})).rejects.toMatchObject({ status: 503 });
    expect(api.start).toHaveBeenCalledTimes(1);

    setup();
    const offline = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    vi.useFakeTimers();
    const run = uploadVideoDirect(file, () => {}, offline);
    const check = expect(run).rejects.toThrow(/internet connection dropped/);
    await vi.runAllTimersAsync();
    await check;
    vi.useRealTimers();
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("HTTP 400"))).toBe(false);
  });
});
