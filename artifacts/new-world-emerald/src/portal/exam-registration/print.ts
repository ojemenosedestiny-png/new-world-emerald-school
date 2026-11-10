import type { ExamRegistrationFormFields } from "@workspace/api-client-react";

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
type Printable = ExamRegistrationFormFields & { studentName: string; studentCode: string; className: string; academicYear: string; title: string; submittedAt: string | null };

const dob = (d: string) => d ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00Z")) : "";

/** One student's form laid out like the school's paper WAEC and NECO registration form. */
function page(f: Printable) {
  const line = (label: string, value: string) => `<div class="line"><span class="l">${esc(label)}:</span><span class="v">${esc(value)}</span></div>`;
  const subjects = Array.from({ length: Math.max(9, f.subjects.length) }, (_, i) => `<li><span class="v">${esc(f.subjects[i] ?? "")}</span></li>`).join("");
  return `<section class="page">
  <header><img src="${esc(`${window.location.origin}/logo.jpg`)}" alt=""><div><h1>NEWWORLD EMERALD PRIVATE SCHOOL F01 KUBWA</h1><h2>WAEC AND NECO REGISTRATION FORM</h2><p class="m">${esc(f.academicYear)} · ${esc(f.className)} · Student ID ${esc(f.studentCode)}</p></div></header>
  <div class="line names"><span class="l">NAME:</span><span class="v">${esc(f.surname.toUpperCase())}</span><span class="v">${esc(f.firstName)}</span><span class="v">${esc(f.middleName)}</span></div>
  <div class="caps"><span>Surname</span><span>First name</span><span>Middle name</span></div>
  ${line("DATE OF BIRTH", dob(f.dateOfBirth))}
  <div class="two">${line("STATE OF ORIGIN", f.stateOfOrigin)}${line("LGA", f.lga)}</div>
  <div class="two">${line("GENDER", f.gender)}${line("NIN", f.nin)}</div>
  <p class="l top">LIST OF SUBJECTS</p><ol>${subjects}</ol>
  ${line("PHONE NUMBER", f.phone)}${line("EMAIL ADDRESS", f.email)}
  <div class="two">${line("SIGNATURE", f.signatureName)}${line("DATE", f.submittedAt ? new Date(f.submittedAt).toLocaleDateString("en-GB") : "")}</div>
  <p class="foot">Submitted online through the New World Emerald student portal.</p></section>`;
}

const STYLE = `@page { size: A4; margin: 16mm; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #111; margin: 0; font-size: 14px; }
.page { page-break-after: always; } .page:last-child { page-break-after: auto; }
header { display: flex; gap: 14px; align-items: center; text-align: center; margin-bottom: 22px; } header img { width: 64px; height: 64px; object-fit: contain; } header div { flex: 1; }
h1 { font-size: 19px; margin: 0; } h2 { font-size: 17px; margin: 6px 0 0; } .m { color: #555; font-size: 12px; margin: 6px 0 0; }
.line { display: flex; gap: 8px; align-items: flex-end; margin: 14px 0; } .l { font-weight: 600; white-space: nowrap; } .v { flex: 1; border-bottom: 1px solid #111; min-height: 20px; padding: 0 4px; font-weight: 600; }
.names .v { text-align: center; } .caps { display: flex; justify-content: space-around; padding-left: 60px; color: #444; font-size: 13px; margin-top: -6px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; } .top { margin-top: 18px; } ol { margin: 6px 0 14px 18px; padding-left: 18px; } li { margin: 6px 0; } li .v { display: block; }
.foot { margin-top: 26px; color: #666; font-size: 11px; }`;

/** Prints one or more forms (one per page). */
export function printRegistrationForms(forms: Printable[]) {
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) return false;
  w.document.open();
  w.document.write(`<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><title>WAEC and NECO registration forms</title><style>${STYLE}</style></head><body>${forms.map(page).join("")}</body></html>`);
  w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch { /* closed */ } };
  if (w.document.readyState === "complete") window.setTimeout(go, 300);
  else w.addEventListener("load", () => window.setTimeout(go, 100), { once: true });
  return true;
}
export const printRegistrationForm = (f: Printable) => printRegistrationForms([f]);

/** A spreadsheet (CSV) of every submitted form, for typing into the WAEC/NECO portals. */
export function registrationsCsv(rows: (ExamRegistrationFormFields & { studentCode: string; className: string; status: string })[]) {
  const cell = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const head = ["Student ID", "Class", "Surname", "First name", "Middle name", "Date of birth", "Gender", "State of origin", "LGA", "NIN", ...Array.from({ length: 9 }, (_, i) => `Subject ${i + 1}`), "Phone", "Email", "Status"];
  const body = rows.map((r) => [r.studentCode, r.className, r.surname, r.firstName, r.middleName, r.dateOfBirth, r.gender, r.stateOfOrigin, r.lga, r.nin, ...Array.from({ length: 9 }, (_, i) => r.subjects[i] ?? ""), r.phone, r.email, r.status].map((v) => cell(String(v))).join(","));
  return [head.join(","), ...body].join("\r\n");
}
