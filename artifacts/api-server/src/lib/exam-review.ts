/**
 * The exam officer's review. When the school has an exam officer, an exam reaches students only once the exam officer
 * publishes it: staff "publishing" sends it for review instead. Approval belongs to the content the exam officer saw,
 * so changing questions or settings takes it away, while hiding and showing an approved exam again does not.
 */
export type ReviewStatus = "" | "submitted" | "returned" | "approved";

export const asReview = (value: string): ReviewStatus => (["submitted", "returned", "approved"].includes(value) ? value as ReviewStatus : "");

/**
 * What a staff save (contentChanged) or publish switch does: whether students may see the exam, its review status,
 * and whether it was just sent to the exam officer.
 */
export function staffPublish(o: { gate: boolean; wantPublished: boolean; wasPublished: boolean; review: ReviewStatus; contentChanged: boolean }):
  { published: boolean; review: ReviewStatus; submitted: boolean } {
  if (!o.gate) return { published: o.wantPublished, review: o.review, submitted: false };
  if (o.contentChanged) {
    return o.wantPublished ? { published: false, review: "submitted", submitted: true } : { published: false, review: "", submitted: false };
  }
  if (!o.wantPublished) return { published: false, review: o.review === "submitted" ? "" : o.review, submitted: false };
  if (o.wasPublished || o.review === "approved") return { published: true, review: o.review, submitted: false };
  return { published: false, review: "submitted", submitted: true };
}
