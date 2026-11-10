// Report card calculations. Pure functions so every rule is unit tested.
import { classSection } from "./principal";

/**
 * How a class is assessed. Secondary (JSS 1 to SS 3): CA (1 and 2) + exam, out of the term's maxima, with positions.
 * Primary (Year 1 to Year 6): a First Half Term and an Second Half Term mark per subject, each out of 100; the final mark is
 * their average ((First Half Term + Second Half Term) / 2), shown as a percentage and average with no positions.
 */
export type ResultScheme = "primary" | "secondary";
export const schemeFor = (className: string): ResultScheme => (classSection(className) === "primary" ? "primary" : "secondary");
/** Primary: First Half Term is stored as CA and Second Half Term as exam, each out of 100. */
export const PRIMARY_MAXIMA = { caMax: 100, ca2Max: 0, examMax: 100 } as const;
export function schemeMaxima<T extends { caMax: number; ca2Max?: number; examMax: number }>(term: T, scheme: ResultScheme): T {
  return scheme === "primary" ? { ...term, ...PRIMARY_MAXIMA } : term;
}
/** What one subject is out of: 100 for primary (an average of two marks out of 100); otherwise CA + exam. */
export const schemePossible = (m: { caMax: number; ca2Max?: number; examMax: number }, scheme: ResultScheme) =>
  scheme === "primary" ? 100 : m.caMax + (m.ca2Max ?? 0) + m.examMax;

/** The school's grading system: A 80+, B 65-79, C 55-64, D 50-54, U (ungraded) below 50. The office can change it in Settings. */
export const GRADE_SCALE = [
  { min: 80, grade: "A", remark: "Excellent" },
  { min: 65, grade: "B", remark: "Very good" },
  { min: 55, grade: "C", remark: "Good" },
  { min: 50, grade: "D", remark: "Pass" },
  { min: 0, grade: "U", remark: "Ungraded" },
] as const;

export type GradeBand = { min: number; grade: string; remark: string };

/** Grade for a percentage (0-100) on a scale ordered from the highest band down. */
export function gradeFor(percent: number, scale: readonly GradeBand[] = GRADE_SCALE) {
  const band = scale.find((b) => percent >= b.min) ?? scale[scale.length - 1];
  return { grade: band.grade, remark: band.remark };
}

/** Checks an office-configured scale: 2 to 12 bands, whole-number minimums from 100 down to a 0 band, distinct grades. */
export function scaleProblem(scale: GradeBand[]): string | null {
  if (scale.length < 2 || scale.length > 12) return "Use between 2 and 12 grades.";
  if (scale.some((b) => !b.grade.trim() || b.grade.trim().length > 4)) return "Each grade needs a short name, such as A or B2.";
  if (scale.some((b) => b.remark.length > 40)) return "Keep each remark under 40 characters.";
  if (scale.some((b) => !Number.isInteger(b.min) || b.min < 0 || b.min > 100)) return "Minimum marks must be whole numbers from 0 to 100.";
  if (scale.some((b, i) => i > 0 && b.min >= scale[i - 1].min)) return "List grades from the highest minimum to the lowest, with no repeats.";
  if (scale[scale.length - 1].min !== 0) return "The lowest grade must start at 0.";
  if (new Set(scale.map((b) => b.grade.trim().toUpperCase())).size !== scale.length) return "Each grade name can be used once.";
  return null;
}

/** Competition ranking: equal values share a position and the next is skipped (1, 1, 3). */
export function rank<T>(items: T[], value: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  const positions = new Map<T, number>();
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1];
    positions.set(item, prev !== undefined && value(prev) === value(item) ? positions.get(prev)! : i + 1);
  });
  return positions;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export type ScoreInput = { studentId: number; subjectId: number; ca: number | null; ca2?: number | null; exam: number | null; total?: number | null; grade?: string | null; comment?: string };
export type SubjectResult = {
  subjectId: number; ca: number | null; ca2: number | null; exam: number | null; total: number;
  percent: number; grade: string; remark: string; position: number; comment: string;
};
export type StudentReport = {
  studentId: number; subjects: SubjectResult[]; total: number; average: number | null;
  grade: string | null; position: number | null; subjectsTaken: number;
};
export type SubjectStats = { subjectId: number; average: number; highest: number; lowest: number; entries: number };
export type ClassReport = { students: StudentReport[]; subjectStats: SubjectStats[]; ranked: number };

/**
 * Builds every student's report for one class and term. A subject counts for a student once
 * either score part is entered. Averages are percentages over subjects taken, so students
 * offering different subjects are compared fairly; students with no scores are not ranked.
 */
export function buildClassReport(
  studentIds: number[], subjectIds: number[], scores: ScoreInput[], maxima: { caMax: number; ca2Max?: number; examMax: number },
  scale: readonly GradeBand[] = GRADE_SCALE, scheme: ResultScheme = "secondary",
): ClassReport {
  const primary = scheme === "primary";
  const possible = schemePossible(maxima, scheme);
  const subjectSet = new Set(subjectIds);
  const byStudent = new Map<number, SubjectResult[]>(studentIds.map((id) => [id, []]));
  const bySubject = new Map<number, { studentId: number; result: SubjectResult }[]>(subjectIds.map((id) => [id, []]));
  for (const s of scores) {
    const typedTotal = s.total ?? null;
    const ca2 = primary ? null : s.ca2 ?? null;
    if (!byStudent.has(s.studentId) || !subjectSet.has(s.subjectId) || (s.ca === null && ca2 === null && s.exam === null && typedTotal === null)) continue;
    // A typed (manual or imported) total and grade take the place of the calculated ones.
    const total = round1(typedTotal ?? (primary ? ((s.ca ?? 0) + (s.exam ?? 0)) / 2 : (s.ca ?? 0) + (ca2 ?? 0) + (s.exam ?? 0)));
    const percent = possible > 0 ? round1((total / possible) * 100) : 0;
    const calculated = gradeFor(percent, scale);
    const typedGrade = s.grade?.trim();
    const grade = typedGrade ? { grade: typedGrade, remark: scale.find((b) => b.grade.toUpperCase() === typedGrade.toUpperCase())?.remark ?? "" } : calculated;
    const result: SubjectResult = { subjectId: s.subjectId, ca: s.ca, ca2, exam: s.exam, total, percent, ...grade, position: 0, comment: s.comment ?? "" };
    byStudent.get(s.studentId)!.push(result);
    bySubject.get(s.subjectId)!.push({ studentId: s.studentId, result });
  }
  const subjectStats: SubjectStats[] = [];
  for (const subjectId of subjectIds) {
    const entries = bySubject.get(subjectId)!;
    // Primary results have no positions.
    if (!primary) {
      const positions = rank(entries, (e) => e.result.total);
      for (const e of entries) e.result.position = positions.get(e)!;
    }
    if (entries.length) {
      const totals = entries.map((e) => e.result.total);
      subjectStats.push({ subjectId, average: round1(totals.reduce((a, b) => a + b, 0) / totals.length), highest: Math.max(...totals), lowest: Math.min(...totals), entries: totals.length });
    }
  }
  const order = new Map(subjectIds.map((id, i) => [id, i]));
  const students: StudentReport[] = studentIds.map((studentId) => {
    const subjects = byStudent.get(studentId)!.sort((a, b) => order.get(a.subjectId)! - order.get(b.subjectId)!);
    const total = round1(subjects.reduce((a, s) => a + s.total, 0));
    const average = subjects.length ? round1(subjects.reduce((a, s) => a + s.percent, 0) / subjects.length) : null;
    return { studentId, subjects, total, average, grade: average === null ? null : gradeFor(average, scale).grade, position: null, subjectsTaken: subjects.length };
  });
  const rankable = students.filter((s) => s.average !== null);
  if (!primary) {
    const positions = rank(rankable, (s) => s.average!);
    for (const s of rankable) s.position = positions.get(s)!;
  }
  return { students, subjectStats, ranked: rankable.length };
}

/** Behaviour (affective) traits rated on report cards, each from 1 (needs attention) to 5 (distinction). */
export const AFFECTIVE_TRAITS = [
  "Punctuality", "Neatness", "Honesty", "Leadership", "Helping others", "Verbal fluency", "Sports", "Musical",
  "Friendliness", "Emotional stability", "Reliability", "Obedience", "Handwriting", "Politeness", "Attendance", "Cooperation",
] as const;

/** Why a set of behaviour ratings cannot be saved, or null. Unrated traits are simply left out. */
export function traitsProblem(traits: Record<string, number>): string | null {
  for (const [name, rating] of Object.entries(traits)) {
    if (!(AFFECTIVE_TRAITS as readonly string[]).includes(name)) return `Unknown behaviour rating: ${name}.`;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return "Behaviour ratings are whole numbers from 1 to 5.";
  }
  return null;
}

/** Validates one score part against its maximum: empty, or 0..max in steps of 0.5. */
export function validScorePart(value: number | null | undefined, max: number) {
  return value === null || value === undefined || (Number.isFinite(value) && value >= 0 && value <= max && Math.round(value * 2) === value * 2);
}

/** A signature image: a PNG, JPEG or WebP data URL of at most about 150 KB. */
export function signatureProblem(value: string | null): string | null {
  if (value === null) return null;
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return "Upload the signature as a PNG, JPEG or WebP picture.";
  if (value.length > 200_000) return "The signature picture is too large. Use one under 150 KB.";
  return null;
}

export type ResultStatus = "draft" | "review" | "approved" | "published";
export type WorkflowAction = "submit" | "withdraw" | "approve" | "return" | "publish" | "unpublish";
/**
 * Draft, then the class teacher's review and signature, then the principal's approval, then published.
 * Returns the next status, or a reason the action is not allowed for this role now.
 */
export function nextStatus(current: ResultStatus, action: WorkflowAction, role: "admin" | "teacher"): { status: ResultStatus } | { problem: string } {
  const office = role === "admin";
  const moves: Record<WorkflowAction, { from: ResultStatus[]; to: ResultStatus; office: boolean }> = {
    submit: { from: ["draft"], to: "review", office: false },
    withdraw: { from: ["review"], to: "draft", office: false },
    approve: { from: ["review"], to: "approved", office: true },
    return: { from: ["review", "approved"], to: "draft", office: true },
    publish: { from: ["approved"], to: "published", office: true },
    unpublish: { from: ["published"], to: "approved", office: true },
  };
  const move = moves[action];
  if (move.office && !office) return { problem: "Only the principal or school office can do this." };
  if (!move.from.includes(current)) {
    const need: Record<WorkflowAction, string> = {
      submit: "Results can be sent for approval only while they are a draft.",
      withdraw: "Only results waiting for approval can be taken back.",
      approve: "The class teacher must review and sign the results first.",
      return: "These results are already a draft.",
      publish: "Approve the results before publishing them.",
      unpublish: "These results are not published.",
    };
    return { problem: need[action] };
  }
  return { status: move.to };
}
