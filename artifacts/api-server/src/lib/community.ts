import type { PortalEventRecord, PortalTeacherRecord } from "@workspace/db";

export type EventInput = {
  title: string; details?: string; venue?: string; category: string; startsAt: string;
  endsAt?: string | null; allDay: boolean; classId?: number | null; published: boolean;
};

/** Validates and normalises an event; returns an error message or the row values. */
export function eventValues(input: EventInput): { error: string } | { values: Omit<PortalEventRecord, "id" | "createdBy" | "createdAt"> } {
  const title = input.title.trim();
  if (!title) return { error: "Give the event a title." };
  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime())) return { error: "Choose when the event starts." };
  let endsAt: Date | null = null;
  if (input.endsAt) {
    endsAt = new Date(input.endsAt);
    if (!Number.isFinite(endsAt.getTime())) return { error: "Choose a valid end time." };
    if (endsAt < startsAt) return { error: "The event cannot end before it starts." };
  }
  return { values: {
    title, details: (input.details ?? "").trim(), venue: (input.venue ?? "").trim(), category: input.category,
    startsAt, endsAt, allDay: input.allDay, classId: input.classId ?? null, published: input.published,
  } };
}

/** Whether a student or teacher may see an event: published, and school-wide or for one of their classes. */
export function eventVisible(event: Pick<PortalEventRecord, "published" | "classId">, classIds: number[]) {
  return event.published && (event.classId === null || classIds.includes(event.classId));
}

/** Public directory rows: never email or other contact details. Sorted by name. */
export function directoryEntries(teachers: PortalTeacherRecord[], classNames: Map<number, string>) {
  return teachers
    .filter((t) => t.active && t.showInDirectory)
    .map((t) => ({
      id: t.id, name: t.name, title: t.title, subjects: t.subjects, photoId: t.photoFileId,
      classNames: t.classIds.map((id) => classNames.get(id)).filter((n): n is string => !!n),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Clean subject list from staff input: trimmed, unique, at most 12. */
export function cleanSubjects(subjects: string[] | undefined) {
  if (!subjects) return undefined;
  const seen = new Set<string>();
  for (const s of subjects) { const v = s.trim().slice(0, 60); if (v && ![...seen].some((x) => x.toLowerCase() === v.toLowerCase())) seen.add(v); }
  return [...seen].slice(0, 12);
}
