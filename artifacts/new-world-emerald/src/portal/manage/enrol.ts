// Bulk enrolment helpers. Rules mirror the server (routes/portal-management.ts).
export const STUDENT_ID_PATTERN = /^[A-Z0-9][A-Z0-9/_-]{0,49}$/;
export const MAX_BULK_STUDENTS = 500;

export type EnrolRow = { line: number; name: string; guardianEmail: string; studentId: string; error?: string };

function splitLine(line: string) {
  // Tab (pasted from a spreadsheet) or comma (CSV). Quotes around a field are removed.
  const parts = line.includes("\t") ? line.split("\t") : line.split(",");
  return parts.map((p) => p.trim().replace(/^"(.*)"$/, "$1").replace(/""/g, '"').trim());
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Parses a class list. Without a header the columns are: Full name, Parent email, Existing
 * Student ID (both optional). A header row (e.g. "Student ID, Name, Parent email") sets the order.
 */
export function parseEnrolList(text: string, existingIds: Iterable<string>): EnrolRow[] {
  const existing = new Set([...existingIds].map((id) => id.toUpperCase()));
  const seen = new Set<string>();
  const rows: EnrolRow[] = [];
  let columns = { name: 0, email: 1, id: 2 };
  let first = true;
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const cells = splitLine(raw);
    if (first) {
      first = false;
      const lower = cells.map((c) => c.toLowerCase());
      if (lower.some((c) => /name/.test(c))) {
        const find = (re: RegExp) => lower.findIndex((c) => re.test(c));
        columns = { name: find(/name/), email: find(/mail/), id: find(/\bid\b|number|admission/) };
        return;
      }
    }
    const at = (i: number) => (i >= 0 ? cells[i] ?? "" : "");
    const name = at(columns.name).replace(/\s+/g, " ").trim();
    const guardianEmail = at(columns.email).toLowerCase();
    const studentId = at(columns.id).toUpperCase();
    let error: string | undefined;
    if (!name) error = "Missing name";
    else if (name.length > 150) error = "Name is too long";
    else if (guardianEmail && !EMAIL.test(guardianEmail)) error = "Parent email is not valid";
    else if (studentId && !STUDENT_ID_PATTERN.test(studentId)) error = "ID may use only letters, numbers, - / _";
    else if (studentId && existing.has(studentId)) error = "ID already enrolled";
    else if (studentId && seen.has(studentId)) error = "ID repeated in this list";
    if (studentId) seen.add(studentId);
    rows.push({ line: index + 1, name, guardianEmail, studentId, error });
  });
  return rows;
}

export type IssuedLogin = { studentId: string; name: string; className: string; password: string };

function csvCell(value: string) {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function loginsCsv(logins: IssuedLogin[]) {
  const lines = [["Student ID", "Name", "Class", "Temporary password"], ...logins.map((l) => [l.studentId, l.name, l.className, l.password])];
  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A printable sheet of cut-out login slips, one per student. */
export function loginSlipsHtml(logins: IssuedLogin[], portalUrl: string) {
  const slips = logins.map((l) => `
    <section class="slip">
      <p class="school">New World Emerald Private School</p>
      <h2>${escapeHtml(l.name)}</h2>
      <p class="class">${escapeHtml(l.className)}</p>
      <dl>
        <dt>Portal</dt><dd>${escapeHtml(portalUrl)}</dd>
        <dt>Student ID</dt><dd class="mono">${escapeHtml(l.studentId)}</dd>
        <dt>Temporary password</dt><dd class="mono">${escapeHtml(l.password)}</dd>
      </dl>
      <p class="note">You will be asked to choose your own password the first time you sign in. Keep it private.</p>
    </section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Student portal login slips</title><style>
    body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:16px;color:#10232c}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
    .slip{border:1.5px dashed #9aa8ad;border-radius:12px;padding:14px 16px;break-inside:avoid}
    .school{margin:0;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#1d6b4f;font-weight:700}
    h2{margin:6px 0 0;font-size:18px}.class{margin:2px 0 8px;font-size:12px;color:#4b5d63}
    dl{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:0;font-size:13px}
    dt{color:#4b5d63}dd{margin:0;font-weight:600;word-break:break-all}.mono{font-family:ui-monospace,Consolas,monospace;font-size:14px}
    .note{margin:8px 0 0;font-size:11px;color:#4b5d63}
    @media print{body{margin:0}.grid{gap:8px}}
  </style></head><body><div class="grid">${slips}</div></body></html>`;
}

export function printLoginSlips(logins: IssuedLogin[]) {
  const portalUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "") + "/portal";
  const w = window.open("", "_blank", "noopener=no,width=900,height=700");
  if (!w) return false;
  w.document.open();
  w.document.write(loginSlipsHtml(logins, portalUrl));
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
