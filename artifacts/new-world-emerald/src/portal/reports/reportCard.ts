import type { GradeBand, ReportCardInfo, ReportStudentResult, ReportSubject, ReportSubjectStats, ReportTerm } from "@workspace/api-client-react";

// Display copy of the server's grade scale (lib/report-cards.ts); the server assigns the grades.
export const GRADE_KEY = [
  { range: "70 - 100", grade: "A", remark: "Excellent" },
  { range: "60 - 69", grade: "B", remark: "Very good" },
  { range: "50 - 59", grade: "C", remark: "Good" },
  { range: "45 - 49", grade: "D", remark: "Fair" },
  { range: "40 - 44", grade: "E", remark: "Pass" },
  { range: "0 - 39", grade: "F", remark: "Fail" },
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

export type PrintableReport = {
  studentName: string; studentId: string; className: string; term: ReportTerm; subjects: ReportSubject[];
  result: ReportStudentResult; subjectStats: ReportSubjectStats[]; classSize: number; card: ReportCardInfo | null;
  gradingScale?: GradeBand[]; teacherName?: string; teacherSignature?: string | null; principalName?: string; principalSignature?: string | null;
};
// Only image data URLs are drawn as signatures; anything else is ignored.
const sigImg = (src: string | null | undefined) => (src && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? `<img class="sigimg" src="${src}" alt="">` : "");

const esc = (value: string | number | null | undefined) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (v: number | null | undefined) => (v === null || v === undefined ? "-" : String(v));

function reportSection(r: PrintableReport) {
  const names = new Map(r.subjects.map((s) => [s.id, s.name]));
  const stats = new Map(r.subjectStats.map((s) => [s.subjectId, s]));
  const rows = r.result.subjects.map((s) => {
    const st = stats.get(s.subjectId);
    return `<tr><td class="l">${esc(names.get(s.subjectId) ?? "Subject")}</td><td>${num(s.ca)}</td><td>${num(s.exam)}</td><td class="b">${s.total}</td><td class="b">${esc(s.grade)}</td><td>${ordinal(s.position)}</td><td>${num(st?.average)}</td><td>${num(st?.highest)}</td><td>${num(st?.lowest)}</td><td class="l">${esc(s.remark)}</td></tr>`;
  }).join("") || `<tr><td colspan="10">No scores recorded for this term.</td></tr>`;
  const att = r.card && r.card.daysOpen !== null ? `${num(r.card.daysPresent)} of ${r.card.daysOpen} days` : "-";
  const pos = r.result.position ? `${ordinal(r.result.position)} of ${r.classSize}` : "-";
  return `
  <section class="card">
    <header>
      <img src="${esc(window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "") + "/logo.jpg")}" alt="">
      <div><h1>New World Emerald Private School</h1><p class="sub">Student Report Card</p><p class="term">${esc(termLabel(r.term))}</p></div>
    </header>
    <dl class="info">
      <div><dt>Name</dt><dd>${esc(r.studentName)}</dd></div>
      <div><dt>Student ID</dt><dd>${esc(r.studentId)}</dd></div>
      <div><dt>Class</dt><dd>${esc(r.className)}</dd></div>
      <div><dt>Attendance</dt><dd>${esc(att)}</dd></div>
    </dl>
    <table>
      <thead><tr><th class="l">Subject</th><th>CA<br><small>/${r.term.caMax}</small></th><th>Exam<br><small>/${r.term.examMax}</small></th><th>Total<br><small>/${r.term.caMax + r.term.examMax}</small></th><th>Grade</th><th>Position</th><th>Class avg</th><th>Highest</th><th>Lowest</th><th class="l">Remark</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary">
      <div><span>Total score</span><b>${r.result.total}</b></div>
      <div><span>Average</span><b>${r.result.average === null ? "-" : r.result.average + "%"}</b></div>
      <div><span>Overall grade</span><b>${esc(r.result.grade ?? "-")}</b></div>
      <div><span>Position in class</span><b>${esc(pos)}</b></div>
    </div>
    <div class="remarks">
      <div><h3>Class teacher's remark</h3><p>${esc(r.card?.teacherRemark || "-")}</p><span class="sig">${sigImg(r.teacherSignature)}${esc(r.teacherName || "Class teacher")}</span></div>
      <div><h3>Principal's remark</h3><p>${esc(r.card?.principalRemark || "-")}</p><span class="sig">${sigImg(r.principalSignature)}${esc(r.principalName || "Principal")}</span></div>
    </div>
    <footer>
      <p class="key">Grading: ${(r.gradingScale?.length ? scaleKey(r.gradingScale) : GRADE_KEY).map((g) => `<b>${g.grade}</b> ${g.range} ${esc(g.remark)}`).join(" &middot; ")}</p>
      ${r.term.nextTermBegins ? `<p class="next">Next term begins: <b>${esc(r.term.nextTermBegins)}</b></p>` : ""}
    </footer>
  </section>`;
}

/** A print-ready A4 document; one page per student. */
/** A whole class's results for one term on one landscape page (or more): every student and subject, ranked. */
export type BroadsheetData = {
  className: string; term: ReportTerm; subjects: ReportSubject[]; students: { id: number; studentId: string; name: string }[];
  results: ReportStudentResult[]; subjectStats: ReportSubjectStats[]; gradingScale?: GradeBand[];
  teacherName?: string; teacherSignature?: string | null; principalName?: string; principalSignature?: string | null;
};

function broadsheetSection(b: BroadsheetData) {
  const byId = new Map(b.students.map((s) => [s.id, s]));
  const scale = b.gradingScale?.length ? b.gradingScale : null;
  const ranked = [...b.results].filter((r) => r.average !== null).sort((x, y) => (x.position ?? 9999) - (y.position ?? 9999));
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
    return `<tr><td>${r.position ? ordinal(r.position) : "-"}</td><td class="l"><b>${esc(st?.name ?? "Student")}</b><small class="id">${esc(st?.studentId ?? "")}</small></td>${cells}<td class="b">${r.total}</td><td class="b">${num(r.average)}</td><td class="b">${esc(r.grade ?? "-")}</td><td>${r.subjectsTaken}</td></tr>`;
  };
  const statRow = (label: string, pick: (s: ReportSubjectStats) => number) => `<tr class="foot"><td></td><td class="l">${label}</td>${b.subjects.map((s) => { const st = b.subjectStats.find((x) => x.subjectId === s.id); return `<td>${st ? pick(st) : "-"}</td>`; }).join("")}<td colspan="4"></td></tr>`;
  const grades = (scale ?? []).map((g) => `<b>${esc(g.grade)}</b> ${ranked.filter((r) => r.grade === g.grade).length}`).join(" &middot; ");
  return `
  <section class="sheet">
    <header>
      <img src="${esc(window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "") + "/logo.jpg")}" alt="">
      <div><h1>New World Emerald Private School</h1><p class="sub">Broadsheet</p><p class="term">${esc(b.className)} &middot; ${esc(termLabel(b.term))} &middot; totals out of ${b.term.caMax + b.term.examMax}</p></div>
    </header>
    <div class="facts">
      <span>Students ranked <b>${ranked.length}</b> of ${b.students.length}</span>
      <span>Class average <b>${avg === null ? "-" : avg + "%"}</b></span>
      <span>Highest <b>${averages.length ? Math.max(...averages) + "%" : "-"}</b></span>
      <span>Lowest <b>${averages.length ? Math.min(...averages) + "%" : "-"}</b></span>
      <span>Passed (${passMark}%+) <b>${averages.filter((a) => a >= passMark).length}</b></span>
      ${grades ? `<span>Grades: ${grades}</span>` : ""}
    </div>
    <table class="bs">
      <thead><tr><th>Pos.</th><th class="l">Student</th>${head}<th class="v"><span>Total</span></th><th class="v"><span>Average %</span></th><th class="v"><span>Grade</span></th><th class="v"><span>Subjects</span></th></tr></thead>
      <tbody>${[...ranked, ...unranked].map(row).join("") || `<tr><td colspan="${b.subjects.length + 6}">No results recorded.</td></tr>`}
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
  .card{padding:6mm 2mm;break-after:page}.card:last-child{break-after:auto}
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
