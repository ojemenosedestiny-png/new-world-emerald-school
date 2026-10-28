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
export function reportCardsHtml(reports: PrintableReport[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Report card${reports.length > 1 ? "s" : ""}</title><style>
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
  </style></head><body>${reports.map(reportSection).join("")}</body></html>`;
}

export function printReportCards(reports: PrintableReport[]) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.open();
  w.document.write(reportCardsHtml(reports));
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
