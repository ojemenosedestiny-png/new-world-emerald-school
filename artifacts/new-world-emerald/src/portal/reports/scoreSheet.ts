// Score-entry helpers for the staff report card workspace. The server validates and grades again.

const GRADE_FLOORS = [{ min: 70, grade: "A" }, { min: 60, grade: "B" }, { min: 50, grade: "C" }, { min: 45, grade: "D" }, { min: 40, grade: "E" }, { min: 0, grade: "F" }];
/** Preview of the grade the server will give, on the school's scale (highest band first). */
export function previewGrade(percent: number, scale?: { min: number; grade: string }[] | number) {
  const bands = Array.isArray(scale) && scale.length ? scale : GRADE_FLOORS;
  return (bands.find((b) => percent >= b.min) ?? bands[bands.length - 1]).grade;
}

/** "" means not entered; otherwise a number 0..max in half marks, or an error message. */
export function parseScorePart(raw: string, max: number): { value: number | null; error?: string } {
  const text = raw.trim();
  if (text === "") return { value: null };
  const value = Number(text);
  if (!Number.isFinite(value)) return { value: null, error: "Not a number" };
  if (value < 0 || value > max) return { value: null, error: `0 to ${max}` };
  if (Math.round(value * 2) !== value * 2) return { value: null, error: "Use whole or half marks" };
  return { value };
}

export type CsvScoreRow = { line: number; studentId: string; ca: number | null; exam: number | null; id?: number; error?: string };

/** Parses "Student ID, CA, Exam" lines (comma or tab). A header row is skipped. */
export function parseScoreCsv(text: string, students: { id: number; studentId: string }[], maxima: { caMax: number; examMax: number }): CsvScoreRow[] {
  const byCode = new Map(students.map((s) => [s.studentId.toUpperCase(), s.id]));
  const seen = new Set<string>();
  const rows: CsvScoreRow[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const parts = (raw.includes("\t") ? raw.split("\t") : raw.split(",")).map((p) => p.trim().replace(/^"(.*)"$/, "$1").trim());
    const [code = "", caRaw = "", examRaw = ""] = parts;
    if (rows.length === 0 && /id/i.test(code) && /ca|exam|score/i.test(parts.slice(1).join(" "))) return;
    const studentId = code.toUpperCase();
    const ca = parseScorePart(caRaw, maxima.caMax);
    const exam = parseScorePart(examRaw, maxima.examMax);
    const id = byCode.get(studentId);
    let error: string | undefined;
    if (!id) error = "Student ID not in this class";
    else if (seen.has(studentId)) error = "Student listed twice";
    else if (ca.error) error = `CA: ${ca.error}`;
    else if (exam.error) error = `Exam: ${exam.error}`;
    seen.add(studentId);
    rows.push({ line: index + 1, studentId, ca: ca.value, exam: exam.value, id, error });
  });
  return rows;
}

/** Starter remarks by average; staff edit or replace them. */
export function suggestedRemarks(average: number | null): string[] {
  if (average === null) return [];
  if (average >= 70) return ["An excellent result. Keep up the outstanding work.", "Hardworking, focused and a pleasure to teach."];
  if (average >= 60) return ["A very good result. Aim even higher next term.", "Consistent effort is paying off. Well done."];
  if (average >= 50) return ["A good result with room to improve. Keep working hard.", "Capable student who should be more consistent."];
  if (average >= 40) return ["A fair result. More effort and regular revision are needed.", "Needs to pay closer attention in class and complete all work."];
  return ["This result is below expectation. Extra support and revision are required.", "Please see the class teacher to agree a plan for improvement."];
}
