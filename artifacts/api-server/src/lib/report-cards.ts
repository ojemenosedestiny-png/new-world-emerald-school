// Report card calculations. Pure functions so every rule is unit tested.

export const GRADE_SCALE = [
  { min: 70, grade: "A", remark: "Excellent" },
  { min: 60, grade: "B", remark: "Very good" },
  { min: 50, grade: "C", remark: "Good" },
  { min: 45, grade: "D", remark: "Fair" },
  { min: 40, grade: "E", remark: "Pass" },
  { min: 0, grade: "F", remark: "Fail" },
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

export type ScoreInput = { studentId: number; subjectId: number; ca: number | null; exam: number | null; total?: number | null; grade?: string | null };
export type SubjectResult = {
  subjectId: number; ca: number | null; exam: number | null; total: number;
  percent: number; grade: string; remark: string; position: number;
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
  studentIds: number[], subjectIds: number[], scores: ScoreInput[], maxima: { caMax: number; examMax: number },
  scale: readonly GradeBand[] = GRADE_SCALE,
): ClassReport {
  const possible = maxima.caMax + maxima.examMax;
  const subjectSet = new Set(subjectIds);
  const byStudent = new Map<number, SubjectResult[]>(studentIds.map((id) => [id, []]));
  const bySubject = new Map<number, { studentId: number; result: SubjectResult }[]>(subjectIds.map((id) => [id, []]));
  for (const s of scores) {
    const typedTotal = s.total ?? null;
    if (!byStudent.has(s.studentId) || !subjectSet.has(s.subjectId) || (s.ca === null && s.exam === null && typedTotal === null)) continue;
    // A typed (manual or imported) total and grade take the place of the calculated ones.
    const total = round1(typedTotal ?? (s.ca ?? 0) + (s.exam ?? 0));
    const percent = possible > 0 ? round1((total / possible) * 100) : 0;
    const calculated = gradeFor(percent, scale);
    const typedGrade = s.grade?.trim();
    const grade = typedGrade ? { grade: typedGrade, remark: scale.find((b) => b.grade.toUpperCase() === typedGrade.toUpperCase())?.remark ?? "" } : calculated;
    const result: SubjectResult = { subjectId: s.subjectId, ca: s.ca, exam: s.exam, total, percent, ...grade, position: 0 };
    byStudent.get(s.studentId)!.push(result);
    bySubject.get(s.subjectId)!.push({ studentId: s.studentId, result });
  }
  const subjectStats: SubjectStats[] = [];
  for (const subjectId of subjectIds) {
    const entries = bySubject.get(subjectId)!;
    const positions = rank(entries, (e) => e.result.total);
    for (const e of entries) e.result.position = positions.get(e)!;
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
  const positions = rank(rankable, (s) => s.average!);
  for (const s of rankable) s.position = positions.get(s)!;
  return { students, subjectStats, ranked: rankable.length };
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
