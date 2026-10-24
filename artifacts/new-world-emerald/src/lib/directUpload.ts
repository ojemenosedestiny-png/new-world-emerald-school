// Admin-only upload code, kept apart from videoSources so the homepage does not load it.
import { completeDirectUpload, signDirectUploadChunk, startDirectUpload } from "@workspace/api-client-react";

/** Videos above this go straight to Cloudinary in pieces; smaller ones use the normal upload. */
export const DIRECT_UPLOAD_FROM_BYTES = 95 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/**
 * Sends a big video from the browser to Cloudinary in pieces (Cloudinary's chunked
 * upload), then has the server record it. The server never handles the file itself.
 * Each piece is signed just before it is sent, so slow uploads do not expire.
 */
export async function uploadVideoDirect(file: File, onProgress: (fraction: number) => void, fetchImpl: typeof fetch = fetch): Promise<string> {
  const grant = await startDirectUpload({ name: file.name, size: file.size, contentType: file.type });
  const uploadId = `nwe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  for (let start = 0; start < file.size; start += grant.chunkSize) {
    const end = Math.min(start + grant.chunkSize, file.size);
    const signed = await signDirectUploadChunk({ token: grant.token });
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
    if (!response) throw new Error("The connection dropped while uploading. Please try again.");
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { message = ((await response.json()) as { error?: { message?: string } }).error?.message ?? message; } catch { /* not JSON */ }
      throw new Error(/too large|size/i.test(message)
        ? `Cloudinary refused the video: ${message}. Your Cloudinary plan may not allow videos this big; paste a YouTube link instead.`
        : `Cloudinary refused the video: ${message}`);
    }
    onProgress(end / file.size);
  }
  const done = await completeDirectUpload({ token: grant.token });
  return done.objectPath;
}
