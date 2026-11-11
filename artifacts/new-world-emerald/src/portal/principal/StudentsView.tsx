import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPrincipalOverviewQueryKey, useManagePrincipal, type PrincipalCommand, type PrincipalOverview } from "@workspace/api-client-react";
import { ArrowLeftRight, GraduationCap, IdCard, Pencil, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { Avatar } from "../photos";
import { MoveStudentDialog } from "../manage/MoveStudent";
import { StudentProfileDialog } from "../profile/StudentProfile";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
type Student = NonNullable<PrincipalOverview["students"]>[number];

function useRun() {
  const m = useManagePrincipal();
  const qc = useQueryClient();
  const { toast } = useToast();
  const run = async (data: PrincipalCommand) => {
    try {
      const r = await m.mutateAsync({ data });
      toast({ title: r.message });
      await qc.invalidateQueries({ queryKey: getGetPrincipalOverviewQueryKey() });
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); return false; }
  };
  return { run, pending: m.isPending };
}

/** Correct a student's name and parent emails, or stop them signing in. */
function EditDialog({ s, onClose, run, pending }: { s: Student | null; onClose: () => void; run: (c: PrincipalCommand) => Promise<boolean>; pending: boolean }) {
  const [f, setF] = useState({ name: "", g1: "", g2: "", active: true });
  const [loaded, setLoaded] = useState<number | null>(null);
  if (s && loaded !== s.id) { setLoaded(s.id); setF({ name: s.name, g1: s.guardianEmail ?? "", g2: s.secondGuardianEmail ?? "", active: s.active !== false }); }
  const close = () => { setLoaded(null); onClose(); };
  const save = async () => {
    if (!s) return;
    if (await run({ action: "editStudent", classId: s.classId, studentId: s.id, studentName: f.name.trim(), guardianEmail: f.g1.trim() || null, secondGuardianEmail: f.g2.trim() || null, active: f.active })) close();
  };
  return (
    <Dialog open={!!s} onOpenChange={(o) => !o && close()}>
      <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Edit student</DialogTitle>
          <DialogDescription>Student ID <span className="font-mono">{s?.studentId}</span> stays the same. Use Move to change class, and Profile for address, phones and health.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <label className="block text-sm font-semibold">Full name<input className="portal-input mt-1" maxLength={150} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="input-edit-student-name" /></label>
          <label className="block text-sm font-semibold">Parent email 1 <span className={"font-normal " + MUTED}>(optional)</span><input type="email" className="portal-input mt-1" maxLength={200} value={f.g1} onChange={(e) => setF({ ...f, g1: e.target.value })} data-testid="input-edit-student-g1" /></label>
          <label className="block text-sm font-semibold">Parent email 2 <span className={"font-normal " + MUTED}>(optional)</span><input type="email" className="portal-input mt-1" maxLength={200} value={f.g2} onChange={(e) => setF({ ...f, g2: e.target.value })} data-testid="input-edit-student-g2" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} data-testid="checkbox-edit-student-active" /> Active (can sign in)</label>
        </div>
        <DialogFooter className="gap-2">
          <button type="button" className="portal-btn-ghost" onClick={close}>Cancel</button>
          <button type="button" className="portal-btn" disabled={pending || f.name.trim().length < 2} onClick={() => void save()} data-testid="button-save-edit-student">{pending ? "Saving..." : "Save"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Every student in the principal's school: search, filter by class, edit, move and open the full profile. */
export function StudentsView({ data }: { data: PrincipalOverview }) {
  const { run, pending } = useRun();
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [moving, setMoving] = useState<Student | null>(null);
  const [profile, setProfile] = useState<number | null>(null);
  const className = useMemo(() => new Map(data.classes.map((c) => [c.id, c.name])), [data.classes]);
  const all = data.students ?? [];
  const q = search.trim().toLowerCase();
  const shown = all.filter((s) => (showInactive || s.active !== false) && (!classId || s.classId === classId)
    && (!q || s.name.toLowerCase().includes(q) || s.studentId.toLowerCase().includes(q) || (s.guardianEmail ?? "").toLowerCase().includes(q)));
  if (!all.length) return <EmptyState icon={<GraduationCap size={22} />} title="No students yet" body="Students appear here once the school office enrols them into your classes." />;
  return (
    <div className="space-y-4" data-testid="principal-students">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search students</span>
          <Search size={15} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" />
          <input className="portal-input !pl-9" placeholder="Search name, student ID or parent email" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-students" />
        </label>
        <select className="portal-input !w-auto" value={classId} onChange={(e) => setClassId(Number(e.target.value))} aria-label="Class" data-testid="select-students-class">
          <option value={0}>All classes</option>
          {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
      </div>
      <p className={"text-sm " + MUTED}>{shown.length} of {all.filter((s) => showInactive || s.active !== false).length} students</p>
      <div className="portal-card divide-y divide-[hsl(var(--p-line))] !p-0">
        {shown.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`principal-student-${s.id}`}>
            <Avatar name={s.name} photoId={s.photoImageId ?? null} size={40} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{s.name} {s.active === false && <StatusPill tone="muted">Inactive</StatusPill>}</p>
              <p className={"text-xs " + MUTED}><span className="font-mono">{s.studentId}</span> · {className.get(s.classId) ?? ""}{s.guardianEmail ? ` · ${s.guardianEmail}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" onClick={() => setProfile(s.id)} data-testid={`button-principal-profile-${s.id}`}><IdCard size={13} /> Profile</button>
              <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" onClick={() => setEditing(s)} data-testid={`button-principal-edit-${s.id}`}><Pencil size={13} /> Edit</button>
              <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" disabled={pending} onClick={() => setMoving(s)} data-testid={`button-principal-move-${s.id}`}><ArrowLeftRight size={13} /> Move</button>
            </div>
          </div>
        ))}
        {!shown.length && <p className={"p-6 text-center text-sm " + MUTED}>No students match.</p>}
      </div>
      <EditDialog s={editing} onClose={() => setEditing(null)} run={run} pending={pending} />
      <MoveStudentDialog student={moving ? { id: moving.id, name: moving.name, classId: moving.classId } : null} classes={data.classes} pending={pending} onClose={() => setMoving(null)}
        onMove={(toClassId) => run({ action: "moveStudent", classId: toClassId, studentId: moving!.id })} />
      <StudentProfileDialog studentId={profile} onClose={() => setProfile(null)} />
    </div>
  );
}
