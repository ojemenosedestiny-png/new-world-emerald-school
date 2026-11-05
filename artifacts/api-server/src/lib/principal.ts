/**
 * The principal's view of teachers' work: plain-English labels for what the staff audit log recorded,
 * grouped into a few kinds, and the boundaries of a school day in Nigeria (Africa/Lagos, UTC+1, no DST).
 */

export type ActivityKind = "register" | "scores" | "exams" | "marking" | "messages" | "assignments" | "notes" | "announcements" | "other";

// Portal commands, recorded as "portal.<action>".
const COMMANDS: Record<string, [ActivityKind, string]> = {
  saveExam: ["exams", "Created or edited an exam"],
  examStatus: ["exams", "Published an exam or released its results"],
  deleteExam: ["exams", "Deleted an exam"],
  addPracticeExams: ["exams", "Added practice exams"],
  grade: ["marking", "Marked an exam script"],
  extendAttempt: ["exams", "Gave a student extra exam time"],
  resetAttempt: ["exams", "Reset a student's exam attempt"],
  saveMaterial: ["notes", "Shared revision notes"],
  deleteMaterial: ["notes", "Removed revision notes"],
  saveNotice: ["announcements", "Posted an announcement"],
  deleteNotice: ["announcements", "Removed an announcement"],
  saveScores: ["scores", "Entered report card scores and comments"],
  saveCards: ["scores", "Wrote report card remarks and ratings"],
  workflow: ["scores", "Sent or took back results for approval"],
  setMode: ["scores", "Changed how results are graded"],
  saveSignature: ["scores", "Updated their signature"],
  saveStudent: ["other", "Updated a student's details"],
};

// Other changes, recorded as "<METHOD> <path>" (without /api).
const PATHS: [RegExp, ActivityKind, string][] = [
  [/^PUT \/portal\/attendance$/, "register", "Took the class register"],
  [/^POST \/portal\/assignments$/, "assignments", "Set an assignment"],
  [/^PUT \/portal\/assignments\/\d+$/, "assignments", "Edited an assignment"],
  [/^DELETE \/portal\/assignments\/\d+$/, "assignments", "Deleted an assignment"],
  [/^POST \/portal\/submissions\/\d+\/mark$/, "marking", "Marked a homework submission"],
  [/^POST \/portal\/message-threads\//, "messages", "Replied to a student's message"],
  [/^POST \/portal\/import$/, "exams", "Imported an exam from a PDF"],
  [/^POST \/portal\/diagrams$/, "exams", "Added a diagram to an exam"],
  [/^(POST|PUT|DELETE) \/portal\/(albums|album-photos)/, "other", "Updated the photo gallery"],
  [/^POST \/portal\/photo-reviews\//, "other", "Reviewed a student's photo"],
  [/^(POST|DELETE) \/portal\/inventory/, "other", "Updated the inventory"],
  [/^(POST|PUT|DELETE) \/portal\/events/, "other", "Updated the events calendar"],
  [/^POST \/portal\/accounts\//, "other", "Managed a student's account"],
  [/^(POST|DELETE) \/portal\/(me|students\/\d+|teachers\/\d+)\/photo$/, "other", "Changed a profile photo"],
];

/** What an audit log action means to the principal, or null for entries that are not teaching work. */
export function describeActivity(action: string): { kind: ActivityKind; label: string } | null {
  if (action.startsWith("portal.")) {
    const hit = COMMANDS[action.slice(7)];
    return hit ? { kind: hit[0], label: hit[1] } : { kind: "other", label: "Worked in the portal" };
  }
  for (const [pattern, kind, label] of PATHS) if (pattern.test(action)) return { kind, label };
  // Reading or marking messages read, and student-only actions, are not shown.
  return null;
}

/** "2026-11-04" as the start and end of that day in Lagos, in UTC. */
export function lagosDay(date: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const startMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 3_600_000;
  const start = new Date(startMs);
  if (Number.isNaN(startMs) || start.toISOString().slice(0, 10) === "Invalid") return null;
  // Reject dates like 2026-02-31 that roll over.
  if (new Date(startMs + 3_600_000).toISOString().slice(0, 10) !== date) return null;
  return { start, end: new Date(startMs + 86_400_000) };
}

/** Today's date in Lagos as "YYYY-MM-DD". */
export function lagosToday(now = new Date()) {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
}

/** The two principals: primary (Year 1 to Year 6) and secondary (Year 7 / JSS 1 to SS 3). */
export type SchoolSection = "primary" | "secondary";

/**
 * Which principal a class belongs to, from its name: "Year 1"–"Year 6", "Primary 4", "Basic 3" or "Grade 2" are
 * primary; "JSS 1"–"JSS 3", "SS 1"–"SS 3" and "Year 7"–"Year 12" are secondary. Nursery, creche and anything
 * else belongs to neither.
 */
export function classSection(name: string): SchoolSection | null {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(jss|js|jhs|sss|ss|shs)\s*[1-3](?!\d)/.test(n)) return "secondary";
  const year = /\b(year|yr|grade|basic|primary|pry)\s*(\d{1,2})(?!\d)/.exec(n);
  if (!year) return null;
  const y = Number(year[2]);
  if (y >= 1 && y <= 6) return "primary";
  if (y >= 7 && y <= 12 && year[1] !== "primary" && year[1] !== "pry") return "secondary";
  return null;
}

const TERM_NAMES = ["Autumn Term", "Spring Term", "Summer Term"];

/**
 * The school term an exam falls in, from its date in Lagos: September to December is the Autumn Term,
 * January to March the Spring Term, April to August the Summer Term. Key "2026-1" is the 2026/2027 Autumn Term.
 */
export function examTerm(date: Date): { key: string; label: string } {
  const lagos = new Date(date.getTime() + 3_600_000);
  const month = lagos.getUTCMonth() + 1, year = lagos.getUTCFullYear();
  const start = month >= 9 ? year : year - 1;
  const n = month >= 9 ? 1 : month <= 3 ? 2 : 3;
  return { key: `${start}-${n}`, label: `${TERM_NAMES[n - 1]}, ${start}/${start + 1}` };
}

/** The last `count` days in Lagos as "YYYY-MM-DD", oldest first, ending on `today`. */
export function lastDays(today: string, count = 7): string[] {
  const end = Date.parse(today + "T12:00:00Z");
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}
