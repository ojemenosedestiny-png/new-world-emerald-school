import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetExamRegistrationAdminQueryKey, useGetExamRegistrationAdmin, useReviewExamRegistration, useSaveExamRegistrationSettings,
  type ExamRegistrationAdmin, type ExamRegistrationRow, type ExamRegistrationSettings,
} from "@workspace/api-client-react";
import { Download, Eye, GraduationCap, Printer, Settings2, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Field, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { ngn } from "../payments/transfers";
import { printRegistrationForms, registrationsCsv } from "./print";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
// From the school's paper form; the office can change them.
export const DEFAULT_COMPULSORY = ["Mathematics", "English Language", "Civic Education", "Livestock Farming"];
export const DEFAULT_OPTIONAL = ["Biology", "Chemistry", "Physics", "Further Mathematics", "Agricultural Science", "Economics", "Government", "Literature in English", "Geography", "Christian Religious Studies", "Islamic Religious Studies", "Commerce", "Financial Accounting", "Data Processing", "Computer Studies", "Technical Drawing", "Visual Arts", "Yoruba", "Igbo", "Hausa", "French", "History", "Marketing", "Catering Craft Practice"];

function currentSession(now = new Date()) {
  const y = now.getFullYear();
  return now.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
const fresh = (d: ExamRegistrationAdmin): ExamRegistrationSettings => ({
  academicYear: d.sessions[0] ?? currentSession(), title: "WAEC and NECO registration", open: false, feeKobo: 0,
  compulsorySubjects: DEFAULT_COMPULSORY, optionalSubjects: DEFAULT_OPTIONAL, maxSubjects: 9,
  classIds: d.classes.filter((c) => /^ss\s*3|^sss\s*3|year\s*12/i.test(c.name)).map((c) => c.id), deadline: "",
});
const formLabel = (r: ExamRegistrationRow) => !r.form ? ["Not started", "muted"] as const : r.form.status === "submitted" ? ["Submitted", "green"] as const : r.form.status === "returned" ? ["Sent back", "red"] as const : ["Draft", "gold"] as const;
const feeLabel = { paid: ["Paid", "green"], pending: ["Being checked", "gold"], due: ["Not paid", "red"] } as const;

/** WAEC/NECO registration for the office and the Head of School: open it with a fee, follow every SS 3 student, print and export the forms. */
export function RegistrationAdmin() {
  const [year, setYear] = useState<string | undefined>(undefined);
  const params = year ? { academicYear: year } : {};
  const q = useGetExamRegistrationAdmin(params, { query: { queryKey: getGetExamRegistrationAdminQueryKey(params) } });
  const saveSettings = useSaveExamRegistrationSettings();
  const review = useReviewExamRegistration();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<ExamRegistrationSettings | null>(null);
  const [naira, setNaira] = useState("");
  // The subject boxes keep exactly what is typed (spaces, new lines); they are split into subjects on Save.
  const [compText, setCompText] = useState("");
  const [optText, setOptText] = useState("");
  const [viewing, setViewing] = useState<ExamRegistrationRow | null>(null);
  const [note, setNote] = useState("");
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <ErrorPanel title="Registration did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const s = d.settings;
  const refresh = () => qc.invalidateQueries({ queryKey: getGetExamRegistrationAdminQueryKey() });
  const openEditor = (base: ExamRegistrationSettings) => {
    setEditing(base); setNaira(base.feeKobo ? String(base.feeKobo / 100) : "");
    setCompText(base.compulsorySubjects.join("\n")); setOptText(base.optionalSubjects.join("\n"));
  };
  const store = async () => {
    if (!editing) return;
    const kobo = Math.round(Number(naira.replace(/[,\s₦]/g, "").replace(/^NGN/i, "") || "0") * 100);
    const compulsorySubjects = lines(compText), optionalSubjects = lines(optText);
    const tooLong = [...compulsorySubjects, ...optionalSubjects].find((x) => x.length > 80);
    const problem = !/^\d{4}\/\d{4}$/.test(editing.academicYear.trim()) ? "Write the session like 2026/2027."
      : !Number.isFinite(kobo) || kobo < 0 || kobo > 1_000_000_000 ? "Enter the fee in naira, for example 45000."
      : tooLong ? `"${tooLong.slice(0, 40)}…" is too long for one subject. Put one subject per line.`
      : compulsorySubjects.length > 15 ? "Up to 15 compulsory subjects."
      : optionalSubjects.length > 80 ? "Up to 80 subjects to choose from."
      : editing.maxSubjects < compulsorySubjects.length ? "Most subjects must include every compulsory subject."
      : editing.open && !editing.classIds.length ? "Choose the SS 3 classes before opening registration."
      : null;
    if (problem) { toast({ variant: "destructive", title: "Check the settings", description: problem }); return; }
    try { const r = await saveSettings.mutateAsync({ data: { ...editing, academicYear: editing.academicYear.trim(), feeKobo: kobo, compulsorySubjects, optionalSubjects, maxSubjects: Math.max(1, Math.min(15, Math.round(Number(editing.maxSubjects) || 9))), deadline: editing.deadline ?? "" } }); toast({ title: r.message }); setYear(editing.academicYear); setEditing(null); await refresh(); }
    catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  const sendBack = async () => {
    if (!viewing?.form) return;
    try { const r = await review.mutateAsync({ id: viewing.form.id, data: { action: "return", note: note.trim() } }); toast({ title: r.message }); setViewing(null); setNote(""); await refresh(); }
    catch (e) { toast({ variant: "destructive", title: "Not sent back", description: errorMessage(e) }); }
  };
  const submitted = d.rows.filter((r) => r.form?.status === "submitted");
  const printable = (r: ExamRegistrationRow) => ({ ...r.form!, studentName: r.studentName, studentCode: r.studentCode, className: r.className, academicYear: s!.academicYear, title: s!.title, submittedAt: r.form!.submittedAt });
  const download = () => {
    const csv = registrationsCsv(submitted.map((r) => ({ ...r.form!, studentCode: r.studentCode, className: r.className, status: r.form!.status })));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `waec-neco-${s!.academicYear.replace("/", "-")}.csv` });
    a.click(); URL.revokeObjectURL(url);
  };
  const lines = (v: string) => v.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {d.sessions.length > 0 && <select className="portal-input !w-auto" value={s?.academicYear ?? ""} onChange={(e) => setYear(e.target.value)} aria-label="Session" data-testid="select-reg-session">{d.sessions.map((x) => <option key={x}>{x}</option>)}</select>}
        <button type="button" className="portal-btn" onClick={() => openEditor(s ?? fresh(d))} data-testid="button-reg-settings"><Settings2 size={15} aria-hidden="true" /> {s ? "Settings" : "Set up registration"}</button>
        {s && <button type="button" className="portal-btn-ghost" onClick={() => openEditor({ ...fresh(d), academicYear: "" })}>New session</button>}
      </div>
      {!s ? <EmptyState icon={<GraduationCap size={22} />} title="WAEC/NECO registration is not set up" body="Set the session, the fee, the subjects and the SS 3 classes, then open it. Students fill the form in their portal; parents pay the fee into the WAEC/NECO account." /> : <>
        <section className="portal-hero rounded-3xl p-6 sm:p-8" aria-label="Registration summary">
          <div className="flex flex-wrap items-center gap-2"><StatusPill tone={s.open ? "green" : "muted"}>{s.open ? "Open" : "Closed"}</StatusPill><span className="text-sm text-white/75">{s.academicYear}{s.deadline ? ` · closes ${s.deadline}` : ""}</span></div>
          <h2 className="mt-2 font-serif text-3xl font-semibold">{s.title}</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {([["Fee", ngn(s.feeKobo)], ["Students", String(d.rows.length)], ["Fee paid", String(d.rows.filter((r) => r.feeStatus === "paid").length)], ["Forms submitted", String(submitted.length)]] as const).map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-white/15 bg-white/[0.07] p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{k}</p><p className="mt-1 font-serif text-2xl font-semibold tabular-nums">{v}</p></div>
            ))}
          </div>
        </section>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="portal-btn-ghost" disabled={!submitted.length} onClick={() => printRegistrationForms(submitted.map(printable))} data-testid="button-print-all-forms"><Printer size={14} aria-hidden="true" /> Print submitted forms</button>
          <button type="button" className="portal-btn-ghost" disabled={!submitted.length} onClick={download} data-testid="button-download-forms"><Download size={14} aria-hidden="true" /> Download spreadsheet</button>
        </div>
        {!d.rows.length ? <EmptyState icon={<GraduationCap size={22} />} title="No students in the chosen classes" body="Choose the SS 3 classes in Settings." /> : (
          <div className="portal-card overflow-x-auto !p-0">
            <table className="w-full min-w-[640px] text-sm" data-testid="table-registrations">
              <thead className={"text-left text-xs uppercase tracking-wider " + MUTED}><tr><th className="px-4 py-3">Student</th><th className="px-3 py-3">Fee</th><th className="px-3 py-3">Form</th><th className="px-3 py-3">Subjects</th><th className="px-4 py-3" /></tr></thead>
              <tbody>{d.rows.map((r) => {
                const [fl, ft] = formLabel(r); const [pl, pt] = feeLabel[r.feeStatus];
                return (
                  <tr key={r.studentId} className="border-t border-[hsl(var(--p-line))]" data-testid={`row-registration-${r.studentId}`}>
                    <td className="px-4 py-3"><b>{r.studentName}</b><span className={"block text-xs " + MUTED}>{r.studentCode} · {r.className}</span></td>
                    <td className="px-3 py-3"><StatusPill tone={pt}>{pl}</StatusPill></td>
                    <td className="px-3 py-3"><StatusPill tone={ft}>{fl}</StatusPill></td>
                    <td className="px-3 py-3 tabular-nums">{r.form?.subjects.length ?? 0}</td>
                    <td className="px-4 py-3 text-right">{r.form && <button type="button" className="portal-btn-ghost !min-h-[32px] !px-3 text-xs" onClick={() => { setNote(""); setViewing(r); }} data-testid={`button-view-form-${r.studentId}`}><Eye size={13} aria-hidden="true" /> Open</button>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </>}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">WAEC/NECO registration</DialogTitle><DialogDescription>Students can submit only after the fee is paid into the WAEC/NECO account and confirmed.</DialogDescription></DialogHeader>
          {editing && <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Session" htmlFor="rs-year"><input id="rs-year" className="portal-input" placeholder="2026/2027" value={editing.academicYear} onChange={(e) => setEditing({ ...editing, academicYear: e.target.value })} data-testid="input-reg-year" /></Field>
              <Field label="Fee (₦)" htmlFor="rs-fee"><input id="rs-fee" inputMode="decimal" className="portal-input tabular-nums" placeholder="e.g. 45000" value={naira} onChange={(e) => setNaira(e.target.value)} data-testid="input-reg-fee" /></Field>
              <Field label="Closing date" htmlFor="rs-deadline" hint="Optional"><input id="rs-deadline" type="date" className="portal-input" value={editing.deadline} onChange={(e) => setEditing({ ...editing, deadline: e.target.value })} /></Field>
            </div>
            <Field label="Title" htmlFor="rs-title"><input id="rs-title" className="portal-input" maxLength={120} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            <fieldset><legend className="text-sm font-semibold">SS 3 classes that register</legend>
              <div className="mt-2 flex flex-wrap gap-2">{d.classes.map((c) => { const on = editing.classIds.includes(c.id); return <button key={c.id} type="button" aria-pressed={on} onClick={() => setEditing({ ...editing, classIds: on ? editing.classIds.filter((x) => x !== c.id) : [...editing.classIds, c.id] })} className={"rounded-full border px-3 py-1.5 text-sm " + (on ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald-soft))] font-semibold" : "border-[hsl(var(--p-line))]")} data-testid={`button-reg-class-${c.id}`}>{c.name}</button>; })}</div></fieldset>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_7rem]">
              <Field label="Compulsory subjects" htmlFor="rs-comp" hint="One per line"><textarea id="rs-comp" className="portal-input min-h-[120px]" value={compText} onChange={(e) => setCompText(e.target.value)} data-testid="input-reg-compulsory" /></Field>
              <Field label="Subjects to choose from" htmlFor="rs-opt" hint="One per line"><textarea id="rs-opt" className="portal-input min-h-[120px]" value={optText} onChange={(e) => setOptText(e.target.value)} data-testid="input-reg-optional" /></Field>
              <Field label="Most subjects" htmlFor="rs-max"><input id="rs-max" type="number" min={1} max={15} className="portal-input" value={editing.maxSubjects} onChange={(e) => setEditing({ ...editing, maxSubjects: Math.max(1, Math.min(15, Number(e.target.value) || 9)) })} /></Field>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-[hsl(var(--p-line))] p-3 text-sm"><input type="checkbox" checked={editing.open} onChange={(e) => setEditing({ ...editing, open: e.target.checked })} data-testid="checkbox-reg-open" /> <span><b>Open registration</b><span className={"block text-xs " + MUTED}>Students in the chosen classes see the form; their parents see the fee.</span></span></label>
          </div>}
          <DialogFooter><button type="button" className="portal-btn" disabled={saveSettings.isPending || !editing?.academicYear.trim()} onClick={() => void store()} data-testid="button-reg-save-settings">Save</button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-xl overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{viewing?.studentName}</DialogTitle><DialogDescription>{viewing?.studentCode} · {viewing?.className}</DialogDescription></DialogHeader>
          {viewing?.form && <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              {([["Surname", viewing.form.surname], ["First name", viewing.form.firstName], ["Middle name", viewing.form.middleName], ["Date of birth", viewing.form.dateOfBirth], ["Gender", viewing.form.gender], ["NIN", viewing.form.nin], ["State of origin", viewing.form.stateOfOrigin], ["LGA", viewing.form.lga], ["Phone", viewing.form.phone], ["Email", viewing.form.email], ["Signature", viewing.form.signatureName]] as const).map(([k, v]) => <div key={k}><dt className={"text-xs " + MUTED}>{k}</dt><dd className="font-semibold">{v || "-"}</dd></div>)}
            </dl>
            <div><p className={"text-xs " + MUTED}>Subjects</p><ol className="mt-1 list-decimal pl-5">{viewing.form.subjects.map((x) => <li key={x}>{x}</li>)}</ol></div>
            {viewing.form.status === "submitted" && <label className="block font-semibold">Send it back to correct <input className="portal-input mt-1" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the student correct?" data-testid="input-reg-return-note" /></label>}
          </div>}
          <DialogFooter className="gap-2">
            {viewing?.form?.status === "submitted" && <button type="button" className="portal-btn-ghost" disabled={review.isPending || note.trim().length < 3} onClick={() => void sendBack()} data-testid="button-reg-return"><Undo2 size={14} aria-hidden="true" /> Send back</button>}
            {viewing?.form && s && <button type="button" className="portal-btn" onClick={() => printRegistrationForms([printable(viewing)])}><Printer size={14} aria-hidden="true" /> Print form</button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
