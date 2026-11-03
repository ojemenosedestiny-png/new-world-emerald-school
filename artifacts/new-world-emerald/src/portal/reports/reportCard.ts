import type { GradeBand, ReportCardInfo, ReportStudentResult, ReportSubject, ReportSubjectStats, ReportTerm } from "@workspace/api-client-react";
import { schemePossible, schemeTerm, type ResultScheme } from "./scheme";

// Display copy of the server's grade scale (lib/report-cards.ts); the server assigns the grades.
export const GRADE_KEY = [
  { range: "80 - 100", grade: "A", remark: "Excellent" },
  { range: "65 - 79", grade: "B", remark: "Very good" },
  { range: "55 - 64", grade: "C", remark: "Good" },
  { range: "50 - 54", grade: "D", remark: "Pass" },
  { range: "0 - 49", grade: "U", remark: "Ungraded" },
];

/** "70 - 100" style ranges for a scale listed from the highest band down. */
export function scaleKey(scale: GradeBand[]) {
  return scale.map((b, i) => ({ range: `${b.min} - ${i === 0 ? 100 : scale[i - 1].min - 1}`, grade: b.grade, remark: b.remark }));
}

export function ordinal(n: number) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return n + "th";
  return n + (["th", "st", "nd", "rd"][n % 10] ?? "th");
}

export const termLabel = (t: Pick<ReportTerm, "session" | "term">) => `${t.term}, ${t.session} session`;

/** Behaviour (affective) traits rated 1 to 5 on report cards; the server keeps the same list. */
export const AFFECTIVE_TRAITS = [
  "Punctuality", "Neatness", "Honesty", "Leadership", "Helping others", "Verbal fluency", "Sports", "Musical",
  "Friendliness", "Emotional stability", "Reliability", "Obedience", "Handwriting", "Politeness", "Attendance", "Cooperation",
] as const;
export const AFFECTIVE_KEY = [[5, "Distinction"], [4, "Very good"], [3, "Good"], [2, "Poor"], [1, "Needs attention"]] as const;

/** Marks a subject is out of this term: CA 1 + CA 2 + exam. */
export const termPossible = (t: Pick<ReportTerm, "caMax" | "examMax"> & { ca2Max?: number }) => t.caMax + (t.ca2Max ?? 0) + t.examMax;

export type PrintableReport = {
  studentName: string; studentId: string; className: string; term: ReportTerm; subjects: ReportSubject[];
  result: ReportStudentResult; subjectStats: ReportSubjectStats[]; classSize: number; card: ReportCardInfo | null;
  gradingScale?: GradeBand[]; teacherName?: string; teacherSignature?: string | null; principalName?: string; principalSignature?: string | null;
  /** Primary (Year 1 to 6) prints Mid-term, End-term and their average, with no positions. */
  scheme?: ResultScheme;
};
// Only image data URLs are drawn as signatures; anything else is ignored.
const sigImg = (src: string | null | undefined) => (src && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? `<img class="sigimg" src="${src}" alt="">` : "");

const esc = (value: string | number | null | undefined) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (v: number | null | undefined) => (v === null || v === undefined ? "-" : String(v));

function reportSection(report: PrintableReport) {
  const primary = report.scheme === "primary";
  const r = { ...report, term: schemeTerm(report.term, report.scheme) };
  const subjectById = new Map(r.subjects.map((s) => [s.id, s]));
  const stats = new Map(r.subjectStats.map((s) => [s.subjectId, s]));
  const twoCa = !primary && (r.term.ca2Max ?? 0) > 0;
  const possible = schemePossible(r.term, r.scheme);
  const rows = primary ? r.result.subjects.map((s) => {
    const st = stats.get(s.subjectId);
    return `<tr><td class="l">${esc(subjectById.get(s.subjectId)?.name ?? "Subject")}</td><td>${num(s.ca)}</td><td>${num(s.exam)}</td><td class="b final">${s.total}</td><td>${num(st?.average)}</td><td class="b">${esc(s.grade)}</td><td>${esc(s.remark)}</td></tr>`;
  }).join("") || `<tr><td colspan="7">No scores recorded for this term.</td></tr>` : r.result.subjects.map((s) => {
    const st = stats.get(s.subjectId);
    return `<tr><td class="l">${esc(subjectById.get(s.subjectId)?.name ?? "Subject")}</td><td>${num(s.ca)}</td>${twoCa ? `<td>${num(s.ca2)}</td>` : ""}<td>${num(s.exam)}</td><td class="b">${s.total}</td><td>${num(st?.highest)}</td><td>${num(st?.lowest)}</td><td>${num(st?.average)}</td><td class="b">${esc(s.grade)}</td><td>${esc(s.remark)}</td></tr>`;
  }).join("") || `<tr><td colspan="${twoCa ? 10 : 9}">No scores recorded for this term.</td></tr>`;
  const open = r.card?.daysOpen ?? null, present = r.card?.daysPresent ?? null;
  const absent = open !== null && present !== null ? open - present : null;
  const attendance = open && present !== null ? `${Math.round((present / open) * 10000) / 100}%` : "-";
  // Class average: the mean of each subject's class average, as a percentage of the marks it is out of.
  const subjectAverages = r.subjectStats.filter((x) => r.subjects.some((s) => s.id === x.subjectId)).map((x) => (x.average / possible) * 100);
  const classAverage = subjectAverages.length && possible ? Math.round((subjectAverages.reduce((a, b) => a + b, 0) / subjectAverages.length) * 100) / 100 : null;
  const traits = r.card?.traits ?? {};
  const traitCells = AFFECTIVE_TRAITS.map((t) => `<td class="l">${esc(t)}</td><td class="b">${num(traits[t])}</td>`);
  const traitRows = [0, 1, 2, 3].map((i) => `<tr>${traitCells.slice(i * 4, i * 4 + 4).join("")}</tr>`).join("");
  const comments = r.result.subjects.map((s) => {
    const subject = subjectById.get(s.subjectId);
    return `<tr><td class="l">${esc(subject?.name ?? "Subject")}</td><td class="l">${esc(s.comment || "")}</td><td class="l">${esc(subject?.teacherName ?? "")}</td></tr>`;
  }).join("") || `<tr><td colspan="3">No subjects recorded.</td></tr>`;
  const scaleRows = (r.gradingScale?.length ? scaleKey(r.gradingScale) : GRADE_KEY).map((g) => `<tr><td class="l">${esc(g.range)}</td><td class="b">${esc(g.grade)}</td><td class="l">${esc(g.remark)}</td></tr>`).join("");
  const affectiveRows = AFFECTIVE_KEY.map(([n, label]) => `<tr><td class="b">${n}</td><td class="l">${label}</td></tr>`).join("");
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  return `
  <section class="card${primary ? " primary" : ""}">
    <header class="crest">
      <img src="${esc(window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "") + "/logo.jpg")}" alt="">
      <div>
        <h1>NEW WORLD EMERALD PRIVATE SCHOOL</h1>
        <p class="levels">CRECHE, NURSERY, PRIMARY &amp; SECONDARY</p>
        <p class="addr">Emerald Building, New World Crescent, Oyigene Audu Avenue, F01 Kubwa, Abuja, Nigeria</p>
        <p class="motto">BELIEVE BIGGER AND AIM HIGHER</p>
      </div>
    </header>
    <p class="session">${esc(r.term.term)} ${esc(r.term.session)} Academic Session${primary ? `<span class="band">Primary section &middot; Year 1 to Year 6</span>` : ""}</p>
    <div class="part1">
      <table class="kv"><thead><tr><th colspan="2" class="l">PART 1: PROFILE</th></tr></thead><tbody>
        <tr><td class="l k">Student name</td><td class="l b">${esc(r.studentName.toUpperCase())}</td></tr>
        <tr><td class="l k">Class</td><td class="l">${esc(r.className.toUpperCase())}</td></tr>
        <tr><td class="l k">Roll no.</td><td class="l">${esc(r.studentId)}</td></tr>
      </tbody></table>
      <table class="kv"><thead><tr><th colspan="2" class="l">ATTENDANCE</th></tr></thead><tbody>
        <tr><td class="l k">School open</td><td>${num(open)}</td></tr>
        <tr><td class="l k">Time(s) present</td><td>${num(present)}</td></tr>
        <tr><td class="l k">Time(s) absent</td><td>${num(absent)}</td></tr>
        <tr><td class="l k">Attendance percentage</td><td>${attendance}</td></tr>
      </tbody></table>
    </div>
    ${primary ? `<table class="scores">
      <thead><tr><th class="l">Subject</th><th>MID-TERM<br><small>(100)</small></th><th>END-TERM<br><small>(100)</small></th><th>FINAL SCORE<br><small>(100)</small></th><th>CLASS AVE.</th><th>GRADE</th><th>REMARK</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="formula">Final score = (Mid-term + End-term) &divide; 2</p>
    <div class="summary">
      <div><span>Total score</span><b>${r.result.total}</b><em>of ${r.result.subjectsTaken * possible}</em></div>
      <div><span>Percentage</span><b>${r.result.average === null ? "-" : r.result.average + "%"}</b><em>${r.result.subjectsTaken} ${r.result.subjectsTaken === 1 ? "subject" : "subjects"}</em></div>
      <div><span>Average</span><b>${r.result.average === null ? "-" : r.result.average}</b><em>class average ${classAverage === null ? "-" : classAverage}</em></div>
      <div><span>Overall grade</span><b>${esc(r.result.grade ?? "-")}</b><em>${esc((r.gradingScale ?? []).find((g) => g.grade === r.result.grade)?.remark ?? "")}</em></div>
    </div>` : `<table class="scores">
      <thead><tr><th class="l">Subject</th><th>${twoCa ? "CA 1" : "CA"}<br><small>(${r.term.caMax})</small></th>${twoCa ? `<th>CA 2<br><small>(${r.term.ca2Max})</small></th>` : ""}<th>EXAM<br><small>(${r.term.examMax})</small></th><th>TOTAL<br><small>(${possible})</small></th><th>HC</th><th>LC</th><th>SUB.AVE</th><th>GRADE</th><th>REMARK</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals"><tbody>
      <tr><td>Subjects offered</td><td class="b">${r.result.subjectsTaken}</td><td>Marks obtainable</td><td class="b">${r.result.subjectsTaken * possible}</td><td>Marks obtained</td><td class="b">${r.result.total}</td></tr>
      <tr><td>Class ave.</td><td class="b">${classAverage === null ? "-" : classAverage + "%"}</td><td>Student ave.</td><td class="b">${r.result.average === null ? "-" : r.result.average + "%"}</td><td>Overall grade</td><td class="b">${esc(r.result.grade ?? "-")}</td></tr>
    </tbody></table>`}
    <table class="traits"><thead><tr><th colspan="8" class="l">PART 2: AFFECTIVE (5 point scale)</th></tr></thead><tbody>${traitRows}</tbody></table>
    <table class="signoff"><colgroup><col style="width:12%"><col style="width:26%"><col style="width:12%"><col style="width:22%"><col style="width:12%"><col style="width:16%"></colgroup><tbody>
      <tr><td class="l k">Teacher's remark</td><td class="l">${esc(r.card?.teacherRemark || "-")}</td><td class="l k">Head teacher remark</td><td class="l">${esc(r.card?.principalRemark || "-")}</td><td class="l k">Date</td><td>${today}</td></tr>
      <tr><td class="l k">Next term begins</td><td class="l">${esc(r.term.nextTermBegins || "-")}</td><td class="l k">Signature</td><td class="sigcell">${sigImg(r.principalSignature)}<span>${esc(r.principalName || "")}</span><em>Principal</em></td><td class="l k">Class teacher name</td><td class="sigcell">${sigImg(r.teacherSignature)}<span>${esc(r.teacherName || "")}</span></td></tr>
    </tbody></table>
    <div class="keys">
      <table><thead><tr><th colspan="3" class="l">GRADING: COGNITIVE</th></tr><tr><th class="l">Score range</th><th>Grade</th><th class="l">Remarks</th></tr></thead><tbody>${scaleRows}</tbody></table>
      <table><thead><tr><th colspan="2" class="l">GRADING: AFFECTIVE</th></tr><tr><th colspan="2" class="l">Key to rating</th></tr></thead><tbody>${affectiveRows}</tbody></table>
    </div>
    <table class="part3"><thead><tr><th colspan="3" class="l">PART 3: SUBJECT PERFORMANCE</th></tr><tr><th class="l">Subject</th><th class="l">Teacher's comment</th><th class="l">Teacher name</th></tr></thead><tbody>${comments}</tbody></table>
  </section>`;
}

/** A print-ready A4 document; one page per student. */
/** A whole class's results for one term on one landscape page (or more): every student and subject, ranked. */
export type BroadsheetData = {
  className: string; term: ReportTerm; subjects: ReportSubject[]; students: { id: number; studentId: string; name: string }[];
  results: ReportStudentResult[]; subjectStats: ReportSubjectStats[]; gradingScale?: GradeBand[];
  teacherName?: string; teacherSignature?: string | null; principalName?: string; principalSignature?: string | null;
  scheme?: ResultScheme;
};

function broadsheetSection(b: BroadsheetData) {
  const primary = b.scheme === "primary";
  const byId = new Map(b.students.map((s) => [s.id, s]));
  const scale = b.gradingScale?.length ? b.gradingScale : null;
  // Primary results have no positions: students are listed by name.
  const ranked = [...b.results].filter((r) => r.average !== null).sort((x, y) => primary
    ? (byId.get(x.studentId)?.name ?? "").localeCompare(byId.get(y.studentId)?.name ?? "")
    : (x.position ?? 9999) - (y.position ?? 9999));
  const unranked = b.results.filter((r) => r.average === null);
  const averages = ranked.map((r) => r.average!);
  const passMark = scale && scale.length > 1 ? scale[scale.length - 2].min : 40;
  const avg = averages.length ? Math.round((averages.reduce((x, y) => x + y, 0) / averages.length) * 10) / 10 : null;
  const head = b.subjects.map((s) => `<th class="v"><span>${esc(s.name)}</span></th>`).join("");
  const row = (r: ReportStudentResult, i: number) => {
    const st = byId.get(r.studentId);
    const cells = b.subjects.map((s) => {
      const x = r.subjects.find((y) => y.subjectId === s.id);
      return x ? `<td>${x.total}<small>${esc(x.grade)}</small></td>` : `<td class="m">-</td>`;
    }).join("");
    return `<tr>${primary ? "" : `<td>${r.position ? ordinal(r.position) : "-"}</td>`}<td class="l"><b>${esc(st?.name ?? "Student")}</b><small class="id">${esc(st?.studentId ?? "")}</small></td>${cells}<td class="b">${r.total}</td><td class="b">${num(r.average)}</td><td class="b">${esc(r.grade ?? "-")}</td><td>${r.subjectsTaken}</td></tr>`;
  };
  const statRow = (label: string, pick: (s: ReportSubjectStats) => number) => `<tr class="foot">${primary ? "" : "<td></td>"}<td class="l">${label}</td>${b.subjects.map((s) => { const st = b.subjectStats.find((x) => x.subjectId === s.id); return `<td>${st ? pick(st) : "-"}</td>`; }).join("")}<td colspan="4"></td></tr>`;
  const grades = (scale ?? []).map((g) => `<b>${esc(g.grade)}</b> ${ranked.filter((r) => r.grade === g.grade).length}`).join(" &middot; ");
  return `
  <section class="sheet">
    <header>
      <img src="${esc(window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "") + "/logo.jpg")}" alt="">
      <div><h1>New World Emerald Private School</h1><p class="sub">${primary ? "Primary broadsheet" : "Broadsheet"}</p><p class="term">${esc(b.className)} &middot; ${esc(termLabel(b.term))} &middot; ${primary ? "final score = (Mid-term + End-term) &divide; 2, out of 100" : `totals out of ${termPossible(b.term)}`}</p></div>
    </header>
    <div class="facts">
      <span>${primary ? "Students with results" : "Students ranked"} <b>${ranked.length}</b> of ${b.students.length}</span>
      <span>Class average <b>${avg === null ? "-" : avg + "%"}</b></span>
      <span>Highest <b>${averages.length ? Math.max(...averages) + "%" : "-"}</b></span>
      <span>Lowest <b>${averages.length ? Math.min(...averages) + "%" : "-"}</b></span>
      <span>Passed (${passMark}%+) <b>${averages.filter((a) => a >= passMark).length}</b></span>
      ${grades ? `<span>Grades: ${grades}</span>` : ""}
    </div>
    <table class="bs">
      <thead><tr>${primary ? "" : "<th>Pos.</th>"}<th class="l">Student</th>${head}<th class="v"><span>Total</span></th><th class="v"><span>Average %</span></th><th class="v"><span>Grade</span></th><th class="v"><span>Subjects</span></th></tr></thead>
      <tbody>${[...ranked, ...unranked].map(row).join("") || `<tr><td colspan="${b.subjects.length + (primary ? 5 : 6)}">No results recorded.</td></tr>`}
      ${statRow("Subject average", (s) => s.average)}${statRow("Highest", (s) => s.highest)}${statRow("Lowest", (s) => s.lowest)}</tbody>
    </table>
    <div class="signs">
      <span>${sigImg(b.teacherSignature)}${esc(b.teacherName || "Class teacher")}</span>
      <span>${sigImg(b.principalSignature)}${esc(b.principalName || "Principal")}</span>
      <span class="date">Printed ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
    </div>
  </section>`;
}

/** The broadsheet on its own, or followed by every student's report card, as one printable document. */
export function resultPackHtml(broadsheet: BroadsheetData, reports: PrintableReport[] = []) {
  return reportCardsHtml(reports, broadsheet);
}

export function reportCardsHtml(reports: PrintableReport[], broadsheet?: BroadsheetData) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${broadsheet ? `${esc(broadsheet.className)} results, ${esc(termLabel(broadsheet.term))}` : `Report card${reports.length > 1 ? "s" : ""}`}</title><style>
  @page{size:A4;margin:12mm}
  body{font-family:Georgia,"Times New Roman",serif;color:#10232c;margin:0}
  .card{padding:2mm;break-after:page;font:10.5px system-ui,sans-serif}.card:last-child{break-after:auto}
  .card table{margin-top:6px;font-size:10px}.card th,.card td{padding:3px 5px}
  .crest{border:2px solid #10232c;padding:8px 12px;gap:16px}.crest img{width:78px;height:86px;border-radius:0}
  .crest h1{font:800 21px Arial,sans-serif;color:#0e6b3a;letter-spacing:.01em}.crest .levels{margin:4px 0 0;font:700 12px Arial,sans-serif;text-align:center}
  .crest .addr{margin:2px 0 0;font:600 10.5px Arial,sans-serif;text-align:center}.crest .motto{margin:4px 0 0;font:700 13px Arial,sans-serif;color:#0e6b3a;text-align:center}
  .session{margin:8px 0 0;font:15px Georgia,serif}
  .part1{display:grid;grid-template-columns:1fr 1fr;gap:10px}.part1 table{margin-top:4px}
  .card td.k{color:#3d4b50;text-transform:uppercase;font-size:9px;letter-spacing:.04em}.card table.kv td.k{width:45%}
  .card th{background:#0e6b3a}.card table.kv th,.card table.traits th,.card table.part3 th,.card .keys th{background:#eef5f0;color:#10232c}
  table.totals td{text-align:left}table.totals td.b{text-align:center}
  table.signoff td{vertical-align:top}table.signoff tr:nth-child(even){background:none}.sigcell{text-align:center;font-size:9.5px}.sigcell span{display:block}.sigcell em{display:block;font-size:9px;color:#5a6a6f}
  .sigcell .sigimg{margin:0 auto 2px;max-height:30px}
  .keys{display:grid;grid-template-columns:3fr 2fr;gap:10px}.keys table{margin-top:6px}
  table.part3 td{text-align:left}
  header{display:flex;align-items:center;gap:14px;border-bottom:3px double #1d6b4f;padding-bottom:10px}
  header img{width:64px;height:64px;border-radius:50%;object-fit:contain}
  h1{margin:0;font-size:22px;color:#14533c}.sub{margin:2px 0 0;font:600 11px system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#a07a1c}
  .term{margin:4px 0 0;font:14px system-ui,sans-serif}
  .info{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}
  .info div{border:1px solid #d9d4c7;border-radius:6px;padding:6px 8px}
  dt{font:600 9px system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#5a6a6f}dd{margin:2px 0 0;font:600 13px system-ui,sans-serif}
  table{width:100%;border-collapse:collapse;font:12px system-ui,sans-serif}
  th,td{border:1px solid #cfc9bb;padding:5px 6px;text-align:center}th{background:#14533c;color:#fff;font-weight:600}
  td.l,th.l{text-align:left}td.b{font-weight:700}tbody tr:nth-child(even){background:#f6f3ea}small{font-weight:400;opacity:.8}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}
  .summary div{background:#eef5f0;border-radius:6px;padding:8px;text-align:center;font:12px system-ui,sans-serif}
  .summary span{display:block;color:#5a6a6f}.summary b{font-size:18px;color:#14533c}
  .remarks{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .remarks div{border:1px solid #d9d4c7;border-radius:6px;padding:8px 10px;min-height:80px;position:relative}
  h3{margin:0;font:600 10px system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#5a6a6f}
  .remarks p{margin:6px 0 44px;font-size:13px}.sig{position:absolute;right:10px;bottom:6px;font:10px system-ui,sans-serif;color:#5a6a6f;border-top:1px solid #8a9599;padding-top:2px;min-width:140px;text-align:center}
  .sigimg{display:block;max-height:34px;max-width:140px;margin:-38px auto 4px;object-fit:contain}
  footer{margin-top:10px;font:10.5px system-ui,sans-serif;color:#5a6a6f}.next{font-size:12px;color:#10232c}
  @page sheet{size:A4 landscape;margin:9mm}
  .sheet{page:sheet;break-after:page}.sheet:last-child{break-after:auto}
  .facts{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0;font:11px system-ui,sans-serif;color:#5a6a6f}.facts b{color:#14533c}
  table.bs{font-size:9.5px}table.bs th,table.bs td{padding:3px 3px}
  table.bs th.v{height:92px;vertical-align:bottom;padding:2px}table.bs th.v span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-weight:600}
  table.bs td small{display:block;font-size:8px;opacity:.75}table.bs td small.id{font-family:Consolas,monospace}
  table.bs td.m{color:#aab}table.bs tr.foot td{background:#eef5f0;font-weight:600}
  table.bs thead{display:table-header-group}table.bs tr{break-inside:avoid}
  .signs{display:flex;gap:40px;margin-top:26px;font:10px system-ui,sans-serif;color:#5a6a6f}
  .signs span{position:relative;border-top:1px solid #8a9599;padding-top:3px;min-width:170px;text-align:center}.signs .date{border:0;margin-left:auto;text-align:right}
  .signs .sigimg{margin:-38px auto 4px}
  .card.primary th{background:#8a5d12}.card.primary table.kv th,.card.primary table.traits th,.card.primary table.part3 th,.card.primary .keys th{background:#fbf3e2;color:#10232c}
  .card.primary .crest{border-color:#8a5d12}.card .band{float:right;font:700 10px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:#8a5d12;border-radius:999px;padding:3px 10px;margin-top:2px}
  .card.primary td.final{background:#fbf3e2;font-size:11px}
  .formula{margin:4px 0 0;font:italic 9.5px system-ui,sans-serif;color:#5a6a6f}
  .card .summary{grid-template-columns:repeat(4,1fr);margin:8px 0 0}.card .summary div{background:#fbf3e2;border:1px solid #e8d7b0;padding:6px}
  .card .summary b{font-size:17px;color:#6b4708}.card .summary em{display:block;font-style:normal;font-size:9px;color:#5a6a6f}
  </style></head><body>${broadsheet ? broadsheetSection(broadsheet) : ""}${reports.map(reportSection).join("")}</body></html>`;
}

export function printReportCards(reports: PrintableReport[], broadsheet?: BroadsheetData) {
  const w = window.open("", "_blank", "width=1100,height=1000");
  if (!w) return false;
  w.document.open();
  w.document.write(reportCardsHtml(reports, broadsheet));
  w.document.close();
  printWhenLoaded(w);
  return true;
}

/** Prints from the opener: the strict Content-Security-Policy blocks inline scripts in the new window. */
function printWhenLoaded(w: Window) {
  const print = () => { try { w.focus(); w.print(); } catch { /* window closed */ } };
  if (w.document.readyState === "complete") window.setTimeout(print, 300);
  else w.addEventListener("load", () => window.setTimeout(print, 100), { once: true });
}
