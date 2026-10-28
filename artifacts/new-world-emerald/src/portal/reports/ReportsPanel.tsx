import { useEffect, useState } from "react";
import { useGetReportWorkspace, getGetReportWorkspaceQueryKey, type ReportTermInput, type ReportWorkspace } from "@workspace/api-client-react";
import { CalendarPlus, FileBarChart, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorPanel, Field, Skeleton } from "../ui";
import { errorMessage } from "../lib";
import { termLabel } from "./reportCard";
import { useReportCommand } from "./useReportCommand";
import { ScoresEditor } from "./ScoresEditor";
import { Broadsheet, RemarksEditor } from "./RemarksBroadsheet";
import { WorkflowBar, resultsLocked } from "./ResultWorkflow";
import { ResultSettings } from "./ResultSettings";

type Section = "scores" | "remarks" | "broadsheet" | "subjects" | "settings";

function TermDialog({ initial, onClose }: { initial: ReportTermInput; onClose: () => void }) {
  const cmd = useReportCommand();
  const [t, setT] = useState(initial);
  const valid = /^\d{4}\/\d{4}$/.test(t.session.trim()) && t.term.trim() && t.caMax + t.examMax > 0;
  const save = async () => { if (await cmd.run({ action: "saveTerm", term: { ...t, nextTermBegins: t.nextTermBegins?.trim() || null } }, t.id ? "Term updated" : "Term created")) onClose(); };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{t.id ? "Edit term" : "New term"}</DialogTitle><DialogDescription>Score maxima apply to every subject in the term.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Session" htmlFor="term-session" hint="e.g. 2026/2027"><input id="term-session" className="portal-input" value={t.session} onChange={(e) => setT({ ...t, session: e.target.value })} data-testid="input-term-session" /></Field>
            <Field label="Term" htmlFor="term-name"><select id="term-name" className="portal-input" value={t.term} onChange={(e) => setT({ ...t, term: e.target.value })} data-testid="select-term-name">{["First Term", "Second Term", "Third Term"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CA maximum" htmlFor="term-ca"><input id="term-ca" type="number" min={0} max={100} className="portal-input" value={t.caMax} onChange={(e) => setT({ ...t, caMax: Number(e.target.value) })} /></Field>
            <Field label="Exam maximum" htmlFor="term-exam"><input id="term-exam" type="number" min={0} max={100} className="portal-input" value={t.examMax} onChange={(e) => setT({ ...t, examMax: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Next term begins" htmlFor="term-next" hint="Shown on report cards, e.g. Monday 12 January 2027"><input id="term-next" className="portal-input" maxLength={40} value={t.nextTermBegins ?? ""} onChange={(e) => setT({ ...t, nextTermBegins: e.target.value })} /></Field>
        </div>
        <DialogFooter><button className="portal-btn" disabled={!valid || cmd.pending} onClick={() => void save()} data-testid="button-save-term">{cmd.pending ? "Saving..." : "Save term"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubjectsEditor({ ws, classId }: { ws: ReportWorkspace; classId: number }) {
  const cmd = useReportCommand();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const add = async () => { if (await cmd.run({ action: "saveSubject", subject: { classId, name: name.trim() } }, "Subject added")) setName(""); };
  return (
    <div className="space-y-4">
      <form className="portal-card flex flex-wrap gap-2 p-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void add(); }}>
        <input className="portal-input min-w-[220px] flex-1" placeholder="Subject name, e.g. Mathematics" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-label="New subject name" data-testid="input-subject-name" />
        <button className="portal-btn" disabled={!name.trim() || cmd.pending} data-testid="button-add-subject"><Plus size={14} /> Add subject</button>
      </form>
      {ws.subjects.length === 0 ? <EmptyState icon={<FileBarChart size={22} />} title="No subjects yet" body="Add each subject this class offers. Subjects belong to the class and are reused every term." /> : (
        <div className="portal-card divide-y divide-[hsl(var(--p-line))]">
          {ws.subjects.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5" data-testid={"subject-row-" + s.id}>
              {editing?.id === s.id
                ? <input className="portal-input !py-1.5 flex-1" value={editing.name} maxLength={80} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Subject name" autoFocus />
                : <p className="flex-1 font-medium">{s.name}</p>}
              {editing?.id === s.id
                ? <button className="portal-btn !py-1.5 text-xs" disabled={!editing.name.trim() || cmd.pending} onClick={async () => { if (await cmd.run({ action: "saveSubject", subject: { id: s.id, classId, name: editing.name.trim(), sortOrder: s.sortOrder } }, "Subject renamed")) setEditing(null); }}>Save</button>
                : <button className="portal-btn-ghost !px-2" onClick={() => setEditing({ id: s.id, name: s.name })} aria-label={"Rename " + s.name}><Pencil size={13} /></button>}
              <button className="portal-btn-ghost !px-2 text-[hsl(var(--p-red))]" disabled={cmd.pending} onClick={() => { if (window.confirm(`Delete ${s.name}? Subjects with scores cannot be deleted.`)) void cmd.run({ action: "deleteSubject", target: { id: s.id } }, "Subject deleted"); }} aria-label={"Delete " + s.name} data-testid={"button-delete-subject-" + s.id}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportsPanel() {
  const [termId, setTermId] = useState<number | undefined>();
  const [classId, setClassId] = useState<number | undefined>();
  const [section, setSection] = useState<Section>("scores");
  const [termForm, setTermForm] = useState<ReportTermInput | null>(null);
  const params = termId && classId ? { termId, classId } : undefined;
  const q = useGetReportWorkspace(params, { query: { queryKey: getGetReportWorkspaceQueryKey(params), placeholderData: (prev) => prev } });
  const ws = q.data;
  useEffect(() => {
    if (!ws) return;
    if (!termId && ws.terms[0]) setTermId(ws.terms[0].id);
    if (!classId && ws.classes[0]) setClassId(ws.classes[0].id);
  }, [ws, termId, classId]);

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-40" /></div>;
  if (q.isError || !ws) return <ErrorPanel title="Report cards did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const term = ws.terms.find((t) => t.id === termId);
  const cls = ws.classes.find((c) => c.id === classId);
  const ready = term && cls && ws.termId === term.id && ws.classId === cls.id;
  const blankTerm: ReportTermInput = { session: `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`, term: "First Term", caMax: 40, examMax: 60, nextTermBegins: "" };
  const missing = ready ? ws.students.filter((s) => (ws.results.find((r) => r.studentId === s.id)?.subjectsTaken ?? 0) < ws.subjects.length).length : 0;
  const sections: [Section, string][] = [["scores", "Scores"], ["remarks", "Remarks & attendance"], ["broadsheet", "Broadsheet & print"], ...(ws.canAdmin ? [["subjects", "Subjects"] as [Section, string]] : []), ["settings", ws.canAdmin ? "Settings" : "My signature"]];
  const locked = resultsLocked(ws);

  if (!ws.terms.length) {
    return (
      <>
        <EmptyState icon={<CalendarPlus size={22} />} title="Set up the first term" body={ws.canAdmin ? "Create a term (for example First Term, 2026/2027) to start recording scores and producing report cards." : "An administrator needs to create a term before scores can be entered."}
          action={ws.canAdmin ? <button className="portal-btn" onClick={() => setTermForm(blankTerm)} data-testid="button-first-term"><CalendarPlus size={15} /> Create term</button> : undefined} />
        {termForm && <TermDialog initial={termForm} onClose={() => setTermForm(null)} />}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <div className="portal-card flex flex-col gap-3 p-4 md:flex-row md:items-end">
        <Field label="Term" htmlFor="rpt-term">
          <select id="rpt-term" className="portal-input md:min-w-[260px]" value={termId ?? ""} onChange={(e) => setTermId(Number(e.target.value))} data-testid="select-report-term">{ws.terms.map((t) => <option key={t.id} value={t.id}>{termLabel(t)}</option>)}</select>
        </Field>
        <Field label="Class" htmlFor="rpt-class">
          <select id="rpt-class" className="portal-input md:min-w-[200px]" value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))} data-testid="select-report-class">{ws.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        {ws.canAdmin && (
          <div className="flex gap-2 md:ml-auto">
            {term && <button className="portal-btn-ghost" onClick={() => setTermForm({ id: term.id, session: term.session, term: term.term, caMax: term.caMax, examMax: term.examMax, nextTermBegins: term.nextTermBegins ?? "" })} data-testid="button-edit-term"><Pencil size={13} /> Edit term</button>}
            <button className="portal-btn-ghost" onClick={() => setTermForm(blankTerm)} data-testid="button-new-term"><CalendarPlus size={13} /> New term</button>
          </div>
        )}
      </div>

      {!ws.classes.length ? <EmptyState icon={<FileBarChart size={22} />} title="No classes" body="Create a class first in the Classes tab." /> : !ready ? <Skeleton className="h-40" /> : (
        <>
          <WorkflowBar ws={ws} term={term} className={cls.name} missing={missing} onOpenSettings={() => setSection("settings")} />

          <div className="flex gap-1 overflow-x-auto rounded-full border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.7)] p-1" role="tablist">
            {sections.map(([key, label]) => <button key={key} role="tab" aria-selected={section === key} className={"portal-tab " + (section === key ? "!bg-[hsl(var(--p-ink))] !text-[hsl(var(--p-paper))]" : "")} onClick={() => setSection(key)} data-testid={"report-section-" + key}>{label}</button>)}
          </div>

          {section === "scores" && <ScoresEditor ws={ws} term={term} locked={locked} />}
          {section === "remarks" && <RemarksEditor ws={ws} term={term} locked={locked} />}
          {section === "broadsheet" && <Broadsheet ws={ws} term={term} className={cls.name} />}
          {section === "subjects" && ws.canAdmin && <SubjectsEditor ws={ws} classId={cls.id} />}
          {section === "settings" && <ResultSettings ws={ws} />}
        </>
      )}

      {termForm && <TermDialog initial={termForm} onClose={() => setTermForm(null)} />}
    </div>
  );
}
