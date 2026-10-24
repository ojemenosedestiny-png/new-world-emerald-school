import { eq } from "drizzle-orm";
import { db, mediaObjects, type MediaObjectRecord } from "@workspace/db";

// Website uploads on Cloudinary. Kept apart from routes/storage.ts so the storage
// routes still load (and their tests run) without a database.
export async function findMediaObject(id: string): Promise<MediaObjectRecord | undefined> {
  const [row] = await db.select().from(mediaObjects).where(eq(mediaObjects.id, id));
  return row;
}

export async function recordMediaObject(values: Omit<MediaObjectRecord, "createdAt">) {
  await db.insert(mediaObjects).values(values);
}
