import { useState, type CSSProperties } from "react";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function imageUrl(id: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return base + "/api/portal/images/" + encodeURIComponent(id);
}

export function initialsOf(name: string) {
  return name.replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

/**
 * Shrinks a photo in the browser before upload: smaller files on mobile data, and
 * re-encoding drops hidden details such as GPS location. Falls back to the original.
 */
export async function preparePhoto(file: File, maxSide: number): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob && blob.size > 0) return blob;
  } catch { /* use the original file below */ }
  if (file.size > MAX_PHOTO_BYTES) throw new Error("This photo is larger than 5MB. Choose a smaller one.");
  return file;
}

/** Round photo with an initials fallback while loading or when there is no photo. */
export function Avatar({ name, photoId, size = 48, hue, className = "", style }: { name: string; photoId?: string | null; size?: number; hue?: string; className?: string; style?: CSSProperties }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = photoId && failed !== photoId;
  return (
    <span className={"relative grid shrink-0 place-items-center overflow-hidden rounded-full font-bold " + className}
      style={{ width: size, height: size, fontSize: size * 0.36, ...(hue ? { background: `hsl(${hue})`, color: "white" } : {}), ...style }} aria-hidden="true">
      {initialsOf(name)}
      {show && <img src={imageUrl(photoId)} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(photoId)} loading="lazy" />}
    </span>
  );
}
