import assert from "node:assert/strict";
import { test } from "node:test";
import { highlights, mondayOf, percent, reportWindow, weeklyReportDue, type DirectorReport } from "./director";
import { directorReportEmail } from "./email";

const base: Omit<DirectorReport, "highlights"> = {
  from: "2026-10-19T06:00:00.000Z", to: "2026-10-26T06:00:00.000Z", generatedAt: "2026-10-26T06:00:00.000Z",
  admissions: { newThisWeek: 0, awaitingReview: 0, total: 0 },
  students: { active: 0, pendingActivation: 0, activatedThisWeek: 0, byClass: [] },
  staff: { activeTeachers: 0 },
  attendance: { rate: null, recorded: 0, absentToday: 0, byClass: [] },
  learning: { examsHeld: 0, attemptsSubmitted: 0, averageScore: null, assignmentsSet: 0, submissions: 0 },
  money: { confirmedKobo: 0, confirmedCount: 0, awaitingKobo: 0, awaitingCount: 0, storeOrders: 0, storeOrdersKobo: 0 },
  messages: { thisWeek: 0, unanswered: 0 },
  website: { liveUpdates: 0 },
  security: { failedSignIns: 0, deniedActions: 0 },
};

test("director: the weekly report is due from 07:00 on Monday, Lagos time, and counted per Monday", () => {
  // 06:30 UTC on Monday 26 Oct 2026 is 07:30 in Lagos (UTC+1).
  assert.equal(weeklyReportDue(new Date("2026-10-26T06:30:00Z")), true);
  assert.equal(weeklyReportDue(new Date("2026-10-26T05:30:00Z")), false, "06:30 Lagos is too early");
  assert.equal(weeklyReportDue(new Date("2026-10-27T06:30:00Z")), false, "Tuesday");
  assert.equal(mondayOf(new Date("2026-10-26T06:30:00Z")), "2026-10-26");
  assert.equal(mondayOf(new Date("2026-11-01T20:00:00Z")), "2026-10-26", "Sunday belongs to the week that started on Monday");
  const w = reportWindow(new Date("2026-10-26T06:30:00Z"));
  assert.deepEqual([w.fromDate, w.toDate], ["2026-10-20", "2026-10-26"]);
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(1, 0), null);
});

test("director: highlights put what needs attention first, in plain words", () => {
  assert.deepEqual(highlights(base), ["No attendance registers were taken this week."]);
  const busy = highlights({
    ...base,
    admissions: { newThisWeek: 2, awaitingReview: 3, total: 9 },
    money: { ...base.money, awaitingCount: 1, awaitingKobo: 15_000_000, confirmedCount: 2, confirmedKobo: 30_000_000 },
    attendance: { rate: 88, recorded: 50, absentToday: 2, byClass: [{ className: "JSS 1", rate: 80, recorded: 25 }, { className: "JSS 2", rate: 96, recorded: 25 }, { className: "SS 1", rate: null, recorded: 0 }] },
    messages: { thisWeek: 4, unanswered: 1 },
    students: { ...base.students, pendingActivation: 5 },
    security: { failedSignIns: 25, deniedActions: 0 },
  });
  assert.match(busy[0], /^3 admission applications waiting for review \(2 new this week\)/);
  assert.ok(busy.some((h) => /1 fee payment \(NGN 150,000\) waiting/.test(h)));
  assert.ok(busy.some((h) => /NGN 300,000 in fees confirmed this week from 2 payments/.test(h)));
  assert.ok(busy.some((h) => h === "Attendance was 88% this week; below 85% in JSS 1."));
  assert.ok(busy.some((h) => h === "No register taken this week for SS 1."));
  assert.ok(busy.some((h) => /1 student conversation waiting/.test(h)));
  assert.ok(busy.some((h) => /25 failed student sign-ins/.test(h)));
});

test("director: the email carries the highlights and figures, escaped, with the dashboard link", () => {
  const r = { ...base, highlights: ["Check <JSS 1> attendance"], attendance: { ...base.attendance, rate: 91, absentToday: 3 } };
  const mail = directorReportEmail(r, "https://school.example/director");
  assert.match(mail.subject, /^Weekly school report: 19 Oct 2026 to 26 Oct 2026$/);
  assert.match(mail.html, /Check &lt;JSS 1&gt; attendance/);
  assert.doesNotMatch(mail.html, /<JSS 1>/);
  assert.match(mail.html, /91% \(3 absent today\)/);
  assert.match(mail.html, /href="https:\/\/school\.example\/director"/);
  assert.match(mail.text, /Dashboard: https:\/\/school\.example\/director/);
});
