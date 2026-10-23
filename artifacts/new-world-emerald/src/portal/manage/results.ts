import type { PortalManagement, PortalManagementAttemptsItem, PortalManagementExamsItem } from "@workspace/api-client-react";

export type RosterStatus = "not_started" | "writing" | "submitted" | "marked";
export type RosterRow = {
  studentId: string;
  name: string;
  status: RosterStatus;
  attempt?: PortalManagementAttemptsItem;
  score?: number;
  totalMarks: number;
  percent?: number;
};
export type ExamStats = { marked: number; average: number; highest: number; lowest: number; passRate: number };

export const PASS_PERCENT = 50;

/** Every active student in the exam's class, plus anyone with an attempt who has since left. */
export function examRoster(data: PortalManagement, exam: PortalManagementExamsItem, now = Date.now()): RosterRow[] {
  const totalMarks = exam.questions.reduce((sum, q) => sum + q.marks, 0);
  const attempts = data.attempts.filter((a) => a.examId === exam.id);
  const byStudent = new Map(attempts.map((a) => [a.studentId, a]));
  const rows: RosterRow[] = [];
  const seen = new Set<string>();
  const add = (studentId: string, name: string, attempt?: PortalManagementAttemptsItem) => {
    seen.add(studentId);
    let status: RosterStatus = "not_started";
    if (attempt) {
      if (attempt.status === "marked") status = "marked";
      else if (attempt.status === "in_progress" && new Date(attempt.deadline).getTime() > now) status = "writing";
      else status = "submitted";
    }
    const score = status === "marked" && typeof attempt?.score === "number" ? attempt.score : undefined;
    rows.push({
      studentId, name, status, attempt, score, totalMarks: attempt?.totalMarks ?? totalMarks,
      percent: score !== undefined && (attempt?.totalMarks ?? totalMarks) > 0 ? Math.round((score / (attempt?.totalMarks ?? totalMarks)) * 1000) / 10 : undefined,
    });
  };
  for (const s of data.students) if (s.classId === exam.classId && s.active) add(s.studentId, s.name, byStudent.get(s.studentId));
  for (const a of attempts) if (!seen.has(a.studentId)) add(a.studentId, a.studentName, a);
  return rows.sort((x, y) => x.name.localeCompare(y.name));
}

export function examStats(rows: RosterRow[]): ExamStats | null {
  const percents = rows.map((r) => r.percent).filter((p): p is number => p !== undefined);
  if (!percents.length) return null;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    marked: percents.length,
    average: round(percents.reduce((s, p) => s + p, 0) / percents.length),
    highest: Math.max(...percents),
    lowest: Math.min(...percents),
    passRate: round((percents.filter((p) => p >= PASS_PERCENT).length / percents.length) * 100),
  };
}

const STATUS_LABEL: Record<RosterStatus, string> = { not_started: "Not started", writing: "Writing", submitted: "Awaiting marking", marked: "Marked" };
export const statusLabel = (status: RosterStatus) => STATUS_LABEL[status];

function csvCell(value: string | number | undefined) {
  let text = value === undefined ? "" : String(value);
  // Stop spreadsheet apps from treating names or answers as formulas.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function resultsCsv(rows: RosterRow[]) {
  const lines = [["Student ID", "Name", "Status", "Score", "Total marks", "Percent"]];
  for (const r of rows) lines.push([r.studentId, r.name, statusLabel(r.status), r.score === undefined ? "" : String(r.score), String(r.totalMarks), r.percent === undefined ? "" : String(r.percent)]);
  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, csv: string) {
  // The byte-order mark lets Excel open names with accents correctly.
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Released results only; unreleased scores are never shown to students. */
export function studentAverage(attempts: { status: string; resultsReleased: boolean; score?: number; totalMarks: number }[]) {
  const released = attempts.filter((a) => a.status === "marked" && a.resultsReleased && typeof a.score === "number" && a.totalMarks > 0);
  if (!released.length) return null;
  const average = released.reduce((s, a) => s + (a.score! / a.totalMarks) * 100, 0) / released.length;
  return { count: released.length, average: Math.round(average * 10) / 10 };
}
