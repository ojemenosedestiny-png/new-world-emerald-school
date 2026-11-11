import { useMemo, useState } from "react";
import type { PrincipalCommand, PrincipalOverview } from "@workspace/api-client-react";
import { SpellCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const key = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();

/** Rename (or remove) a subject in every class of the school at once, e.g. a misspelling made in many arms. */
export function FixSubject({ data, run, pending }: { data: PrincipalOverview; run: (c: PrincipalCommand) => Promise<boolean>; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState<"rename" | "remove">("rename");
  const [newName, setNewName] = useState("");
  // Every subject name in the school, with the classes that have it.
  const names = useMemo(() => {
    const m = new Map<string, { name: string; classes: string[] }>();
    for (const c of data.classes) for (const s of c.subjects) {
      const k = key(s.name);
      const e = m.get(k) ?? { name: s.name.trim(), classes: [] };
      e.classes.push(c.name); m.set(k, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.classes]);
  const chosen = names.find((n) => key(n.name) === key(subject));
  const existing = mode === "rename" && newName.trim() ? names.find((n) => key(n.name) === key(newName) && key(n.name) !== key(subject)) : undefined;
  const close = () => { setOpen(false); setSubject(""); setNewName(""); setMode("rename"); };
  const go = async () => {
    if (!chosen) return;
    const ok = await run(mode === "rename"
      ? { action: "renameSubject", classId: data.classes[0].id, subjectName: chosen.name, newSubjectName: newName.trim() }
      : { action: "removeSubject", classId: data.classes[0].id, subjectName: chosen.name });
    if (ok) close();
  };
  if (!data.classes.length) return null;
  return (
    <>
      <button type="button" className="portal-btn-ghost" onClick={() => setOpen(true)} data-testid="button-fix-subject"><SpellCheck size={15} aria-hidden="true" /> Fix a subject name</button>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="portal !min-h-0 max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Fix a subject name</DialogTitle>
            <DialogDescription>Correct a misspelt subject in every class at once, or remove it. Teachers and marks are kept.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block text-sm font-semibold">Subject
              <select className="portal-input mt-1" value={subject} onChange={(e) => { setSubject(e.target.value); setNewName(e.target.value); }} data-testid="select-fix-subject">
                <option value="">Choose the subject…</option>
                {names.map((n) => <option key={n.name} value={n.name}>{n.name} ({n.classes.length} {n.classes.length === 1 ? "class" : "classes"})</option>)}
              </select>
            </label>
            {chosen && <p className={"text-xs " + MUTED}>In: {chosen.classes.join(", ")}</p>}
            <fieldset className="flex gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "rename"} onChange={() => setMode("rename")} data-testid="radio-fix-rename" /> Correct the spelling</label>
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "remove"} onChange={() => setMode("remove")} data-testid="radio-fix-remove" /> Remove it</label>
            </fieldset>
            {mode === "rename" ? (
              <label className="block text-sm font-semibold">Correct name
                <input className="portal-input mt-1" maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Social and Citizenship Studies" data-testid="input-fix-subject-name" />
                {existing && <span className="mt-1 block text-xs font-normal text-[hsl(var(--p-emerald))]">{existing.name} already exists in {existing.classes.length} {existing.classes.length === 1 ? "class" : "classes"}: the two will be merged there.</span>}
              </label>
            ) : <p className={"rounded-xl bg-[hsl(var(--p-gold-soft)/0.6)] p-3 text-sm"}>It is removed from every class where no marks have been entered for it. Classes with marks keep it, and you will be told which.</p>}
          </div>
          <DialogFooter className="gap-2">
            <button type="button" className="portal-btn-ghost" onClick={close}>Cancel</button>
            <button type="button" className="portal-btn" disabled={pending || !chosen || (mode === "rename" && (!newName.trim() || key(newName) === key(chosen.name) && newName.trim() === chosen.name))} onClick={() => void go()} data-testid="button-confirm-fix-subject">
              {pending ? "Saving..." : mode === "rename" ? "Correct everywhere" : "Remove"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
