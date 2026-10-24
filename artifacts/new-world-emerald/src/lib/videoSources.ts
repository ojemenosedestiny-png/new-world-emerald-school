/** Live updates store YouTube videos as objectPath "youtube:<id>" with this type. */
export const YOUTUBE_CONTENT_TYPE = "video/youtube";
const ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character video id from any usual YouTube link (watch, youtu.be, shorts, live, embed), or null. */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (ID.test(text)) return text;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "").toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v");
    if (!id) {
      const [, kind, value] = url.pathname.split("/");
      if (["shorts", "live", "embed", "v"].includes(kind)) id = value ?? null;
    }
  }
  return id && ID.test(id) ? id : null;
}

export const youTubeIdFromPath = (objectPath: string) => (objectPath.startsWith("youtube:") ? objectPath.slice("youtube:".length) : null);
export const youTubeEmbedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
