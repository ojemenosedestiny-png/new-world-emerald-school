// Upload responses contain /objects/<id>, not an API-serving URL.
// Use the same URL in the staged preview, saved product, and public catalogue.
export function productPhotoUrl(objectPath: string, basePath = ""): string {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid uploaded photo path");
  return `${basePath.replace(/\/$/, "")}/api/storage${objectPath}`;
}