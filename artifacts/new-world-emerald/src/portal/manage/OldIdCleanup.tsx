import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPortalManagementQueryKey, useApplyOldStudentIdCleanup, usePreviewOldStudentIdCleanup, type OldStudentIdPlan } from "@workspace/api-client-react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ErrorPanel, Skeleton } from "../ui";
import { errorMessage } from "../lib";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const list = (xs: string[]) => (xs.length ? xs.join(", ") : "no records");

/**
 * After everyone was enrolled again with admission numbers, the old records (old-style IDs) still show. Each old record
 * that has a new one with the same name is joined to it: the old record keeps its results, attendance and history and
 * takes the new ID, password and class; the empty new copy goes. Old records with no new one are removed if empty.
 */
export function OldIdCleanupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const preview = usePreviewOldStudentIdCleanup();
  const apply = useApplyOldStudentIdCleanup();
  const [plan, setPlan] = useState<OldStudentIdPlan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [join, setJoin] = useState<Set<number>>(new Set());
  // For each old record that did not pair: "keep", "remove" (only when it has nothing in it), or a new record's id to join.
  const [choice, setChoice] = useState<Record<number, string>>({});

  const load = async () => {
    setError(null);
    try {
      const p = await preview.mutateAsync();
      setPlan(p);
      setJoin(new Set(p.pairs.filter((x) => x.status === "ready").map((x) => x.old.id)));
      setChoice(Object.fromEntries([
        ...p.unpaired.map((u) => [u.student.id, u.records.length ? "keep" : "remove"]),
        ...p.pairs.filter((x) => x.status !== "ready").map((x) => [x.old.id, "keep"]),
      ]));
    } catch (e) { setError(e); }
  };
  useEffect(() => { if (open) void load(); else { setPlan(null); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const flip = (set: Set<number>, id: number, on: boolean) => { const next = new Set(set); if (on) next.add(id); else next.delete(id); return next; };
  const ready = plan?.pairs.filter((p) => p.status === "ready") ?? [];
  const check = plan?.pairs.filter((p) => p.status !== "ready") ?? [];
  // Everything not joined automatically: unpaired old records, and pairs a person must look at.
  const others = [
    ...(plan?.unpaired.map((u) => ({ id: u.student.id, student: u.student, records: u.records, note: u.note })) ?? []),
    ...check.map((p) => ({ id: p.old.id, student: p.old, records: p.oldRecords, note: p.status === "ambiguous" ? `Two old records fit ${p.new.name} (${p.new.studentId}).` : `${p.new.name} (${p.new.studentId}) already has ${list(p.newRecords)}, so it is not joined automatically.` })),
  ];
  const manual = others.filter((o) => /^\d+$/.test(choice[o.id] ?? "")).map((o) => ({ oldId: o.id, newId: Number(choice[o.id]) }));
  const removeIds = others.filter((o) => choice[o.id] === "remove").map((o) => o.id);
  const joins = [...ready.filter((p) => join.has(p.old.id)).map((p) => ({ oldId: p.old.id, newId: p.new.id })), ...manual];
  const pickedTwice = new Set(joins.map((j) => j.newId)).size !== joins.length;
  const go = async () => {
    const pairs = joins;
    const ids = removeIds;
    if (!pairs.length && !ids.length) return;
    if (!window.confirm(`Tidy up ${pairs.length + ids.length} old records? Joined students keep their results and history under their new ID and password. This cannot be undone.`)) return;
    try {
      const r = await apply.mutateAsync({ data: { join: pairs, remove: ids } });
      toast({ title: "Old IDs tidied up", description: r.message });
      await qc.invalidateQueries({ queryKey: getGetPortalManagementQueryKey() });
      onClose();
    } catch (e) { toast({ variant: "destructive", title: "Not done", description: errorMessage(e) }); void load(); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-4xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Remove old IDs</DialogTitle>
          <DialogDescription>For each student enrolled again with an admission number, the old record is joined to the new one: results, attendance, CBT and history are kept, and the student signs in with the new ID and new password. The duplicate disappears.</DialogDescription>
        </DialogHeader>
        {error ? <ErrorPanel title="Could not check the old IDs" message={errorMessage(error)} onRetry={() => void load()} />
          : !plan ? <Skeleton className="h-64" />
          : (
            <div className="space-y-5">
              {!plan.pairs.length && !plan.unpaired.length && <p className="rounded-xl bg-[hsl(var(--p-emerald)/0.08)] p-4 text-sm font-semibold" data-testid="text-no-old-ids">No old IDs left. Every student has an admission number.</p>}

              {ready.length > 0 && (
                <section data-testid="old-ids-ready">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">Join old record to new ID ({ready.length})</h3>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ready.every((p) => join.has(p.old.id))} onChange={(e) => setJoin(e.target.checked ? new Set(ready.map((p) => p.old.id)) : new Set())} /> All</label>
                  </div>
                  <div className="mt-2 max-h-[38dvh] divide-y divide-[hsl(var(--p-line))] overflow-y-auto rounded-xl border border-[hsl(var(--p-line))]">
                    {ready.map((p) => (
                      <label key={p.old.id} className="flex cursor-pointer items-start gap-3 p-2.5 text-sm" data-testid={`old-pair-${p.old.id}`}>
                        <input type="checkbox" className="mt-1" checked={join.has(p.old.id)} onChange={(e) => setJoin(flip(join, p.old.id, e.target.checked))} />
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold">{p.new.name}</span> <span className={MUTED}>· {p.new.className}</span><br />
                          <span className="font-mono text-xs line-through opacity-60">{p.old.studentId}</span> <ArrowRight size={11} className="inline" /> <span className="font-mono text-xs font-semibold">{p.new.studentId}</span>
                          <span className={"block text-xs " + MUTED}>Keeps: {list(p.oldRecords)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {others.length > 0 && (
                <section data-testid="old-ids-others">
                  <h3 className="font-semibold">Old records that did not pair ({others.length})</h3>
                  <p className={"text-xs " + MUTED}>Choose the student's new record to join it, remove an empty one, or keep it as it is.</p>
                  <div className="mt-2 max-h-[38dvh] divide-y divide-[hsl(var(--p-line))] overflow-y-auto rounded-xl border border-[hsl(var(--p-line))]">
                    {others.map((o) => (
                      <div key={o.id} className="flex flex-col gap-2 p-2.5 text-sm sm:flex-row sm:items-center" data-testid={`old-other-${o.id}`}>
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold">{o.student.name}</span> <span className={MUTED}>· {o.student.className} · <span className="font-mono">{o.student.studentId}</span></span>
                          <span className={"block text-xs " + MUTED}>{o.note} Has {list(o.records)}.</span>
                        </div>
                        <select className="portal-input !w-full !py-1.5 text-xs sm:!w-72" value={choice[o.id] ?? "keep"} onChange={(e) => setChoice({ ...choice, [o.id]: e.target.value })} aria-label={`What to do with ${o.student.name}`} data-testid={`select-old-${o.id}`}>
                          <option value="keep">Keep as it is</option>
                          {!o.records.length && <option value="remove">Remove (nothing in it)</option>}
                          <optgroup label="Join to new record">
                            {plan.newOptions.map((n) => <option key={n.id} value={String(n.id)}>{n.name} · {n.className} · {n.studentId}</option>)}
                          </optgroup>
                        </select>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {pickedTwice && <p className="rounded-xl bg-[hsl(var(--p-red)/0.1)] p-3 text-sm font-semibold text-[hsl(var(--p-red))]">The same new record is chosen twice. Each new record can join one old record.</p>}

              <div className="flex justify-end">
                <button type="button" className="portal-btn" disabled={apply.isPending || pickedTwice || (!joins.length && !removeIds.length)} onClick={() => void go()} data-testid="button-apply-old-ids">
                  {apply.isPending && <Loader2 size={15} className="animate-spin" />} Tidy up {joins.length + removeIds.length} old records
                </button>
              </div>
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}
