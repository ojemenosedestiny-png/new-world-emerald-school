/** Primary (Year 1 to 6) or secondary (JSS 1 to SS 3, Year 7 to 12) from a class name; the server uses the same rule. */
export function classSection(name: string): "primary" | "secondary" | null {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(jss|js|jhs|sss|ss|shs)\s*[1-3](?!\d)/.test(n)) return "secondary";
  const year = /\b(year|yr|grade|basic|primary|pry)\s*(\d{1,2})(?!\d)/.exec(n);
  if (!year) return null;
  const y = Number(year[2]);
  if (y >= 1 && y <= 6) return "primary";
  if (y >= 7 && y <= 12 && year[1] !== "primary" && year[1] !== "pry") return "secondary";
  return null;
}

export type TeacherGroup = "primary" | "secondary" | "both" | "none";
/** Which school a teacher works in, from the classes they teach. */
export function teacherGroup(classIds: number[], classes: { id?: number | null; name: string }[]): TeacherGroup {
  const sections = new Set(classIds.map((id) => classSection(classes.find((c) => c.id === id)?.name ?? "")).filter(Boolean));
  if (sections.has("primary") && sections.has("secondary")) return "both";
  if (sections.has("primary")) return "primary";
  if (sections.has("secondary")) return "secondary";
  return "none";
}
export const GROUP_LABEL: Record<TeacherGroup, string> = { primary: "Primary teachers (Year 1 to 6)", secondary: "Secondary teachers (JSS 1 to SS 3)", both: "Teach in both schools", none: "No class yet" };
