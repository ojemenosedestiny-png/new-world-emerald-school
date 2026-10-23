import { useEffect, useMemo, useState } from "react";
import type { ReportWorkspace, ReportTerm } from "@workspace/api-client-react";
import { Eye, Printer, Save, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "../ui";
import { ordinal, printReportCards, type PrintableReport } from "./reportCard";
import { suggestedRemarks } from "./scoreSheet";
import { useReportCommand } from "./useReportCommand";
import { Users } from "lucide-react";

type CardDraft = { teacherRemark: string; principalRemark: string; daysPresent: string; daysOpen: string };
const n = (s: string) => (s.trim() === "" ? null : Number(s));

export function RemarksEditor({ ws, term, locked }: { ws: ReportWorkspace; term: ReportTerm; locked: boolean }) {
  const cmd = useReportCommand();
  const saved = useMemo(() => {
    const map: Record<number, CardDraft> = {};
    for (const st of ws.students) {
      const c = ws.cards.find((x) => x.studentId === st.id);
      map[st.id] = { teacherRemark: c?.teacherRemark ?? "", principalRemark: c?.principalRemark ?? "", daysPresent: c?.daysPresent?.toString() ?? "", daysOpen: c?.daysOpen?.toString() ?? "" };
    }
    return map;
  }, [ws.students, ws.cards]);
  const [draft, setDraft] = useState(saved);
  const [daysOpenAll, setDaysOpenAll] = useState("");
  useEffect(() => { setDraft(saved); }, [saved]);
  if (!ws.students.length) return <EmptyState icon={<Users size={22} />} title="No active students" body="Enrol students in this class to write their remarks." />;

  const set = (id: number, patch: Partial<CardDraft>) => setDraft((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const changed = ws.students.filter((st) => JSON.stringify(draft[st.id]) !== JSON.stringify(saved[st.id]));
  const invalid = ws.students.some((st) => {
    const d = draft[st.id]; const p = n(d.daysPresent), o = n(d.daysOpen);
    return [p, o].some((v) => v !== null && (!Number.isInteger(v) || v < 0 || v > 366)) || (p !== null && o !== null && p > o);
  });
  const save = () => cmd.run({ action: "saveCards", cards: { termId: term.id, entries: changed.map((st) => { const d = draft[st.id]; return { studentId: st.id, teacherRemark: d.teacherRemark, principalRemark: d.principalRemark, daysPresent: n(d.daysPresent), daysOpen: n(d.daysOpen) }; }) } }, "Remarks saved");

  return (
    <div className="space-y-4">
      <div className="portal-card flex flex-wrap items-center gap-3 p-4">
        <label className="flex items-center gap-2 text-sm">Days school opened this term
          <input inputMode="numeric" className="portal-input !w-24 !py-1.5" value={daysOpenAll} disabled={locked} onChange={(e) => setDaysOpenAll(e.target.value)} data-testid="input-days-open-all" />
        </label>
        <button className="portal-btn-ghost" disabled={locked || !daysOpenAll.trim()} onClick={() => setDraft((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, daysOpen: daysOpenAll.trim() }])))} data-testid="button-apply-days-open">Apply to all</button>
        <button className="portal-btn ml-auto" disabled={locked || !changed.length || invalid || cmd.pending} onClick={() => void save()} data-testid="button-save-remarks"><Save size={14} /> {cmd.pending ? "Saving..." : changed.length ? `Save ${changed.length} ${changed.length === 1 ? "change" : "changes"}` : "Saved"}</button>
      </div>
      {invalid && <p className="text-xs text-[hsl(var(--p-red))]">Days must be whole numbers, and days present cannot exceed days opened.</p>}
      <div className="space-y-3">
        {ws.students.map((st) => {
          const d = draft[st.id]; const result = ws.results.find((r) => r.studentId === st.id);
          return (
            <div key={st.id} className="portal-card p-4" data-testid={"remarks-row-" + st.id}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1"><p className="font-semibold">{st.name}</p><p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{result?.average != null ? `Average ${result.average}% / ${ordinal(result.position!)} of ${ws.ranked}` : "No scores yet"}</p></div>
                <label className="flex items-center gap-1.5 text-xs">Present<input inputMode="numeric" className="portal-input !w-16 !py-1" value={d.daysPresent} disabled={locked} onChange={(e) => set(st.id, { daysPresent: e.target.value })} aria-label={`Days present for ${st.name}`} /></label>
                <label className="flex items-center gap-1.5 text-xs">of<input inputMode="numeric" className="portal-input !w-16 !py-1" value={d.daysOpen} disabled={locked} onChange={(e) => set(st.id, { daysOpen: e.target.value })} aria-label={`Days opened for ${st.name}`} /></label>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <label className="portal-label" htmlFor={"tr-" + st.id}>Class teacher's remark</label>
                  <textarea id={"tr-" + st.id} className="portal-input mt-1 min-h-[64px] text-sm" maxLength={600} value={d.teacherRemark} disabled={locked} onChange={(e) => set(st.id, { teacherRemark: e.target.value })} />
                  {!locked && suggestedRemarks(result?.average ?? null).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">{suggestedRemarks(result?.average ?? null).map((s) => <button key={s} type="button" className="rounded-full border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.8)] px-2 py-0.5 text-[11px] hover:border-[hsl(var(--p-emerald))]" onClick={() => set(st.id, { teacherRemark: s })}><Sparkles size={10} className="mr-1 inline" />{s}</button>)}</div>
                  )}
                </div>
                <div>
                  <label className="portal-label" htmlFor={"pr-" + st.id}>Principal's remark {!ws.canAdmin && <span className="normal-case tracking-normal opacity-60">(administrators only)</span>}</label>
                  <textarea id={"pr-" + st.id} className="portal-input mt-1 min-h-[64px] text-sm" maxLength={600} value={d.principalRemark} disabled={locked || !ws.canAdmin} onChange={(e) => set(st.id, { principalRemark: e.target.value })} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function printableFor(ws: ReportWorkspace, term: ReportTerm, className: string, studentIds?: number[]): PrintableReport[] {
  return ws.students.filter((s) => !studentIds || studentIds.includes(s.id)).map((st) => ({
    studentName: st.name, studentId: st.studentId, className, term, subjects: ws.subjects,
    result: ws.results.find((r) => r.studentId === st.id) ?? { studentId: st.id, subjects: [], total: 0, average: null, grade: null, position: null, subjectsTaken: 0 },
    subjectStats: ws.subjectStats, classSize: ws.ranked, card: ws.cards.find((c) => c.studentId === st.id) ?? null,
  }));
}

export function Broadsheet({ ws, term, className }: { ws: ReportWorkspace; term: ReportTerm; className: string }) {
  const { toast } = useToast();
  const print = (ids?: number[]) => { if (!printReportCards(printableFor(ws, term, className, ids))) toast({ variant: "destructive", title: "Pop-up blocked", description: "Allow pop-ups for this site to print report cards." }); };
  if (!ws.students.length || !ws.subjects.length) return <EmptyState icon={<Users size={22} />} title="Nothing to show yet" body="Add subjects and enter scores to see the class broadsheet." />;
  const sorted = [...ws.students].sort((a, b) => (ws.results.find((r) => r.studentId === a.id)?.position ?? 9999) - (ws.results.find((r) => r.studentId === b.id)?.position ?? 9999));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[hsl(var(--p-ink)/0.65)]">{ws.ranked} of {ws.students.length} students ranked. Totals out of {term.caMax + term.examMax}.</p>
        <button className="portal-btn" onClick={() => print()} data-testid="button-print-all-reports"><Printer size={14} /> Print all report cards</button>
      </div>
      <div className="portal-card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm" data-testid="table-broadsheet">
          <thead className="bg-[hsl(var(--p-ink))] text-[hsl(var(--p-paper))]">
            <tr><th className="px-3 py-2 text-left">Pos.</th><th className="px-3 py-2 text-left">Student</th>{ws.subjects.map((s) => <th key={s.id} className="px-2 py-2 text-center font-semibold">{s.name}</th>)}<th className="px-2 py-2">Total</th><th className="px-2 py-2">Avg %</th><th className="px-2 py-2">Grade</th><th className="px-2 py-2"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--p-line))]">
            {sorted.map((st) => {
              const r = ws.results.find((x) => x.studentId === st.id);
              return (
                <tr key={st.id} className="odd:bg-[hsl(var(--p-surface)/0.7)] even:bg-[hsl(var(--p-paper-2)/0.5)]">
                  <td className="px-3 py-2 font-bold">{r?.position ? ordinal(r.position) : "-"}</td>
                  <td className="px-3 py-2"><p className="font-semibold">{st.name}</p><p className="font-mono text-[11px] opacity-50">{st.studentId}</p></td>
                  {ws.subjects.map((s) => { const x = r?.subjects.find((y) => y.subjectId === s.id); return <td key={s.id} className="px-2 py-2 text-center tabular-nums">{x ? <>{x.total} <span className="text-xs font-bold opacity-60">{x.grade}</span></> : <span className="opacity-30">-</span>}</td>; })}
                  <td className="px-2 py-2 text-center font-semibold tabular-nums">{r?.subjectsTaken ? r.total : "-"}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{r?.average ?? "-"}</td>
                  <td className="px-2 py-2 text-center font-bold">{r?.grade ?? "-"}</td>
                  <td className="px-2 py-2"><button className="portal-btn-ghost !px-2 !py-1 text-xs" onClick={() => print([st.id])} aria-label={`Preview ${st.name}'s report card`} data-testid={"button-preview-report-" + st.id}><Eye size={12} /> Card</button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-[hsl(var(--p-emerald-soft)/0.6)] text-xs">
            {(["average", "highest", "lowest"] as const).map((k) => (
              <tr key={k}><td /><td className="px-3 py-1.5 font-semibold capitalize">Class {k}</td>{ws.subjects.map((s) => <td key={s.id} className="px-2 py-1.5 text-center tabular-nums">{ws.subjectStats.find((x) => x.subjectId === s.id)?.[k] ?? "-"}</td>)}<td colSpan={4} /></tr>
            ))}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
