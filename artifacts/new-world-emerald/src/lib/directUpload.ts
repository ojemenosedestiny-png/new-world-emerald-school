// Admin-only upload code, kept apart from videoSources so the homepage does not load it.
import { completeDirectUpload, signDirectUploadChunk, startDirectUpload } from "@workspace/api-client-react";

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const NETWORK_ERROR = "The internet connection dropped while uploading. Check your connection and try again; a strong Wi-Fi signal works best for videos.";

/** The browser's own wording for a request that never got an answer ("Failed to fetch", "Load failed", ...). */
export function isNetworkError(error: unknown) {
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

/** Retries short steps (signing, confirming) after a dropped connection, a server hiccup or, when allowed, "not ready yet". */
async function retrying<T>(step: () => Promise<T>, retryOn: number[] = [], tries = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      // 503 means Cloudinary is not set up, which waiting will not fix.
      const again = isNetworkError(error) || (status >= 500 && status !== 503) || retryOn.includes(status);
      if (!again || attempt >= tries) throw isNetworkError(error) ? new Error(NETWORK_ERROR) : error;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/**
 * Sends a big video from the browser to Cloudinary in pieces (Cloudinary's chunked
 * upload), then has the server record it. The server never handles the file itself.
 * Each piece is signed just before it is sent, so slow uploads do not expire.
 */
export async function uploadVideoDirect(file: File, onProgress: (fraction: number) => void, fetchImpl: typeof fetch = fetch): Promise<string> {
  const grant = await retrying(() => startDirectUpload({ name: file.name, size: file.size, contentType: file.type }));
  const uploadId = `nwe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  for (let start = 0; start < file.size; start += grant.chunkSize) {
    const end = Math.min(start + grant.chunkSize, file.size);
    const signed = await retrying(() => signDirectUploadChunk({ token: grant.token }));
    const form = new FormData();
    form.append("file", file.slice(start, end), file.name);
    form.append("api_key", signed.apiKey);
    form.append("timestamp", String(signed.timestamp));
    form.append("signature", signed.signature);
    form.append("public_id", signed.publicId);
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetchImpl(grant.uploadUrl, {
          method: "POST", body: form, credentials: "omit",
          headers: { "X-Unique-Upload-Id": uploadId, "Content-Range": `bytes ${start}-${end - 1}/${file.size}` },
        });
        if (response.ok || response.status < 500) break;
      } catch { response = null; }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (!response) throw new Error(NETWORK_ERROR);
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { message = ((await response.json()) as { error?: { message?: string } }).error?.message ?? message; } catch { /* not JSON */ }
      throw new Error(/too large|size/i.test(message)
        ? `Cloudinary refused the video: ${message}. Your Cloudinary plan may not allow videos this big; paste a YouTube link instead.`
        : `Cloudinary refused the video: ${message}`);
    }
    onProgress(end / file.size);
  }
  // Cloudinary can take a moment to finish a big video after the last piece.
  const done = await retrying(() => completeDirectUpload({ token: grant.token }), [409], 6);
  return done.objectPath;
}
