import { expect, it } from "vitest";
import { activeStudentExams } from "../src/portal/lib";
import { IDLE_MINUTES } from "../src/components/IdleSignOut";

const now = Date.parse("2026-10-29T10:00:00Z");
const exam = (id: number, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt });
const exams = [
  exam(1, "2026-10-29T09:00:00Z", "2026-10-29T12:00:00Z"), // open, not started
  exam(2, "2026-10-29T09:00:00Z", "2026-10-29T12:00:00Z"), // open, being written
  exam(3, "2026-10-29T09:00:00Z", "2026-10-29T12:00:00Z"), // open, just submitted
  exam(4, "2026-10-28T09:00:00Z", "2026-10-28T12:00:00Z"), // closed yesterday, marked
  exam(5, "2026-10-28T09:00:00Z", "2026-10-28T12:00:00Z"), // closed, never sat
  exam(6, "2026-10-30T09:00:00Z", "2026-10-30T12:00:00Z"), // upcoming
];
const attempts = [{ examId: 2, status: "in_progress" }, { examId: 3, status: "submitted" }, { examId: 4, status: "marked" }];

it("keeps only exams the student still has to write: finished and closed exams leave at once", () => {
  expect(activeStudentExams(exams, attempts, now).map((e) => e.id)).toEqual([1, 2, 6]);
});

it("signs out after an hour without activity", () => {
  expect(IDLE_MINUTES).toBe(60);
});
