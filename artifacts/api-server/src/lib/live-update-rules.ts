// Big videos go straight to Cloudinary in pieces; very long ones can be YouTube links.
const maxVideoSize = 500 * 1024 * 1024;
// A YouTube video is stored as objectPath "youtube:<11-character id>" with type "video/youtube".
export const YOUTUBE_PATH = /^youtube:[A-Za-z0-9_-]{11}$/;

export function isVideoPayload(payload: {
  contentType?: string;
  fileSize?: number;
  objectPath?: string;
}) {
  if (payload.contentType === "video/youtube") return YOUTUBE_PATH.test(payload.objectPath ?? "");
  return Boolean(
    payload.contentType?.startsWith("video/") &&
      payload.objectPath?.startsWith("/objects/") &&
      payload.fileSize &&
      payload.fileSize <= maxVideoSize,
  );
}
