// Importing past results from the old portal. Pure functions so every rule is unit tested;
// the route supplies the students, classes, terms and subjects that already exist.

/** Parses CSV text (commas or semicolons; quoted fields may contain commas, quotes and line breaks). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

export const IMPORT_COLUMNS = [
  { key: "studentId", label: "Student ID", aliases: ["student id", "admission number", "admission no", "reg no", "registration number", "student number", "id"] },
  { key: "studentName", label: "Student name", aliases: ["student name", "name", "full name"] },
  { key: "className", label: "Class", aliases: ["class", "class name", "arm"] },
  { key: "session", label: "Session", aliases: ["session", "academic session", "year", "academic year"] },
  { key: "term", label: "Term", aliases: ["term"] },
  { key: "subject", label: "Subject", aliases: ["subject", "subject name", "course"] },
  { key: "ca", label: "CA", aliases: ["ca", "ca score", "continuous assessment", "test", "ca total"] },
  { key: "exam", label: "Exam", aliases: ["exam", "exam score", "examination"] },
  { key: "total", label: "Total", aliases: ["total", "total score", "score"] },
  { key: "grade", label: "Grade", aliases: ["grade"] },
  { key: "teacherRemark", label: "Teacher comment", aliases: ["teacher comment", "teacher's comment", "teacher remark", "class teacher comment", "form teacher comment"] },
  { key: "principalRemark", label: "Principal comment", aliases: ["principal comment", "principal's comment", "principal remark", "head teacher comment"] },
  { key: "daysPresent", label: "Days present", aliases: ["days present", "attendance"] },
  { key: "daysOpen", label: "Days open", aliases: ["days open", "days school opened", "times school opened"] },
] as const;
export type ImportKey = (typeof IMPORT_COLUMNS)[number]["key"];
export type RawResult = Record<ImportKey, string> & { line: number };

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, " ").replace(/[^\w' ]/g, "");
/** The downloadable template: headings, and two made-up rows to show the format. */
export function templateCsv() {
  const head = IMPORT_COLUMNS.map((c) => c.label);
  const rows = [
    ["NWE/2021/00001", "Sample Student", "JSS 1", "2021/2022", "First Term", "Mathematics", "32", "51", "83", "A", "A hardworking student.", "Excellent result.", "58", "60"],
    ["NWE/2021/00001", "Sample Student", "JSS 1", "2021/2022", "First Term", "English Language", "28", "44", "72", "A", "A hardworking student.", "Excellent result.", "58", "60"],
  ];
  return [head, ...rows].map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\r\n") + "\r\n";
}

/** Matches the heading row to known columns; Student ID, Class, Session, Term and Subject are required. */
export function mapColumns(header: string[]): { map: Partial<Record<ImportKey, number>>; missing: string[] } {
  const map: Partial<Record<ImportKey, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    const col = IMPORT_COLUMNS.find((c) => norm(c.label) === n || (c.aliases as readonly string[]).includes(n));
    if (col && map[col.key] === undefined) map[col.key] = i;
  });
  const missing: string[] = (["studentId", "className", "session", "term", "subject"] as const).filter((k) => map[k] === undefined).map((k) => IMPORT_COLUMNS.find((c) => c.key === k)!.label);
  if (map.total === undefined && map.ca === undefined && map.exam === undefined) missing.push("Total (or CA and Exam)");
  return { map, missing };
}

export function rowsFromCsv(text: string): { rows: RawResult[]; missing: string[] } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], missing: ["a heading row"] };
  const { map, missing } = mapColumns(table[0]);
  const rows = table.slice(1).map((cells, i) => {
    const r = { line: i + 2 } as RawResult;
    for (const c of IMPORT_COLUMNS) r[c.key] = map[c.key] === undefined ? "" : (cells[map[c.key]!] ?? "").trim();
    return r;
  });
  return { rows, missing };
}

/** "1st", "first", "1", "First Term" all mean "First Term". */
export function normalTerm(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s*term\s*/, "");
  if (["1", "1st", "first"].includes(t)) return "First Term";
  if (["2", "2nd", "second"].includes(t)) return "Second Term";
  if (["3", "3rd", "third"].includes(t)) return "Third Term";
  return null;
}
/** "2021/2022", "2021-2022" and "2021/22" all mean "2021/2022". */
export function normalSession(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})\s*[/-]\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2].length === 2 ? Math.floor(start / 100) * 100 + Number(m[2]) : Number(m[2]);
  return end === start + 1 ? `${start}/${end}` : null;
}
export const classKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (raw: string) => (raw.trim() === "" ? null : Number(raw.replace(/,/g, ".").trim()));

export interface Lookups {
  students: Map<string, { id: number; name: string }>;
  classes: Map<string, { id: number; name: string }>;
  /** "session|term" to the term's id and score maxima. */
  terms: Map<string, { id: number; caMax: number; examMax: number }>;
  /** "classId|subject name lower-case" to the subject id. */
  subjects: Map<string, number>;
  /** "termId|studentId|subjectId" already holding a score. */
  existingScores: Set<string>;
  /** "termId|classId" whose results are past draft (cannot be changed by an import). */
  locked: Map<string, string>;
}
export type CheckedRow = {
  line: number; status: "ok" | "warning" | "error"; messages: string[];
  studentDbId?: number; studentId: string; studentName: string; className: string; classId?: number;
  session: string; term: string; subject: string;
  ca: number | null; exam: number | null; total: number | null; grade: string | null;
  teacherRemark: string; principalRemark: string; daysPresent: number | null; daysOpen: number | null;
};

/**
 * Checks every row against the school's records. Errors are never saved: unknown students or classes,
 * bad session or term, scores outside the term's maxima, and the same student, term and subject twice.
 * Warnings are saved: a name that differs, a new term or subject to be created, or a score that will be replaced.
 */
export function checkRows(rows: RawResult[], lookups: Lookups, newTermMaxima: { caMax: number; examMax: number }): CheckedRow[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const messages: string[] = [];
    let error = false;
    const fail = (m: string) => { messages.push(m); error = true; };
    const student = lookups.students.get(r.studentId.trim().toUpperCase().replace(/\s+/g, ""));
    if (!r.studentId.trim()) fail("Student ID is missing.");
    else if (!student) fail(`No student with ID ${r.studentId}. Enrol them first.`);
    else if (r.studentName && classKey(r.studentName) !== classKey(student.name)) messages.push(`Name differs: the portal has ${student.name}.`);
    const cls = lookups.classes.get(classKey(r.className));
    if (!r.className.trim()) fail("Class is missing.");
    else if (!cls) fail(`No class named ${r.className}. Create it in Classes first.`);
    const session = normalSession(r.session);
    if (!session) fail(`Session "${r.session}" should look like 2021/2022.`);
    const term = normalTerm(r.term);
    if (!term) fail(`Term "${r.term}" should be First, Second or Third.`);
    const subject = r.subject.trim().replace(/\s+/g, " ");
    if (!subject) fail("Subject is missing.");
    else if (subject.length > 80) fail("Subject name is too long.");

    const existingTerm = session && term ? lookups.terms.get(`${session}|${term}`) : undefined;
    const maxima = existingTerm ?? newTermMaxima;
    if (session && term && !existingTerm) messages.push(`New term ${term}, ${session} will be created.`);
    const ca = num(r.ca), exam = num(r.exam), total = num(r.total);
    const bad = (v: number | null, max: number) => v !== null && (!Number.isFinite(v) || v < 0 || v > max || Math.round(v * 2) !== v * 2);
    if (bad(ca, maxima.caMax)) fail(`CA "${r.ca}" must be 0 to ${maxima.caMax}, in half marks.`);
    if (bad(exam, maxima.examMax)) fail(`Exam "${r.exam}" must be 0 to ${maxima.examMax}, in half marks.`);
    if (bad(total, maxima.caMax + maxima.examMax)) fail(`Total "${r.total}" must be 0 to ${maxima.caMax + maxima.examMax}.`);
    if (ca === null && exam === null && total === null) fail("No score: give a Total, or CA and Exam.");
    if (!error && total !== null && (ca !== null || exam !== null) && Math.abs((ca ?? 0) + (exam ?? 0) - total) > 0.5) messages.push(`Total ${total} differs from CA + exam (${(ca ?? 0) + (exam ?? 0)}); the total is kept.`);
    const grade = r.grade.trim().toUpperCase() || null;
    if (grade && grade.length > 4) fail(`Grade "${r.grade}" is too long.`);
    const daysPresent = num(r.daysPresent), daysOpen = num(r.daysOpen);
    for (const [v, label] of [[daysPresent, "Days present"], [daysOpen, "Days open"]] as const) if (v !== null && (!Number.isInteger(v) || v < 0 || v > 366)) fail(`${label} must be a whole number of days.`);
    if (daysPresent !== null && daysOpen !== null && daysPresent > daysOpen) fail("Days present cannot be more than days open.");
    if (r.teacherRemark.length > 600 || r.principalRemark.length > 600) fail("Comments must be under 600 characters.");

    if (student && cls && session && term && subject) {
      const key = `${session}|${term}|${student.id}|${subject.toLowerCase()}`;
      if (seen.has(key)) fail(`Duplicate: ${subject} for this student and term is already in the file.`);
      seen.add(key);
      const subjectId = lookups.subjects.get(`${cls.id}|${subject.toLowerCase()}`);
      if (subjectId === undefined) messages.push(`New subject ${subject} will be added to ${cls.name}.`);
      if (existingTerm) {
        const locked = lookups.locked.get(`${existingTerm.id}|${cls.id}`);
        if (locked) fail(`${cls.name}'s results for ${term}, ${session} are ${locked}. Return them to draft before importing.`);
        if (subjectId !== undefined && lookups.existingScores.has(`${existingTerm.id}|${student.id}|${subjectId}`)) messages.push("A score is already saved; it will be replaced.");
      }
    }
    return {
      line: r.line, status: error ? "error" : messages.length ? "warning" : "ok", messages,
      studentDbId: student?.id, studentId: r.studentId.trim(), studentName: student?.name ?? r.studentName, className: cls?.name ?? r.className, classId: cls?.id,
      session: session ?? r.session, term: term ?? r.term, subject, ca, exam, total, grade,
      teacherRemark: r.teacherRemark.trim(), principalRemark: r.principalRemark.trim(), daysPresent, daysOpen,
    };
  });
}
