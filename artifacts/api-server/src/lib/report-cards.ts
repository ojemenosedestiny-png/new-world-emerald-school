// Report card calculations. Pure functions so every rule is unit tested.

export const GRADE_SCALE = [
  { min: 70, grade: "A", remark: "Excellent" },
  { min: 60, grade: "B", remark: "Very good" },
  { min: 50, grade: "C", remark: "Good" },
  { min: 45, grade: "D", remark: "Fair" },
  { min: 40, grade: "E", remark: "Pass" },
  { min: 0, grade: "F", remark: "Fail" },
] as const;

/** Grade for a percentage (0-100). */
export function gradeFor(percent: number) {
  const band = GRADE_SCALE.find((b) => percent >= b.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1];
  return { grade: band.grade, remark: band.remark };
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

export type ScoreInput = { studentId: number; subjectId: number; ca: number | null; exam: number | null };
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
): ClassReport {
  const possible = maxima.caMax + maxima.examMax;
  const subjectSet = new Set(subjectIds);
  const byStudent = new Map<number, SubjectResult[]>(studentIds.map((id) => [id, []]));
  const bySubject = new Map<number, { studentId: number; result: SubjectResult }[]>(subjectIds.map((id) => [id, []]));
  for (const s of scores) {
    if (!byStudent.has(s.studentId) || !subjectSet.has(s.subjectId) || (s.ca === null && s.exam === null)) continue;
    const total = round1((s.ca ?? 0) + (s.exam ?? 0));
    const percent = possible > 0 ? round1((total / possible) * 100) : 0;
    const result: SubjectResult = { subjectId: s.subjectId, ca: s.ca, exam: s.exam, total, percent, ...gradeFor(percent), position: 0 };
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
    return { studentId, subjects, total, average, grade: average === null ? null : gradeFor(average).grade, position: null, subjectsTaken: subjects.length };
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
