import { useState } from "react";
import type { PortalManagement, PortalManagementStudentsItem, PortalManagementTeachersItem } from "@workspace/api-client-react";
import { Copy, GraduationCap, KeyRound, ListPlus, Pencil, Plus, Printer, School, UserCheck, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, Field, StatusPill } from "../ui";
import { generateTempPassword } from "../lib";
import { ClassSelect } from "./ClassSelect";
import { className, useCommand } from "./useCommand";
import { BulkEnrol } from "./BulkEnrol";
import { printLoginSlips, type IssuedLogin } from "./enrol";

export function ClassesPanel({ data }: { data: PortalManagement }) {
  const cmd = useCommand();
  const [editing, setEditing] = useState<{ id?: number; name: string } | null>(null);
  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    if (await cmd.run({ action: "saveClass", schoolClass: { ...editing, name: editing.name.trim() } }, editing.id ? "Class renamed" : "Class created")) setEditing(null);
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="portal-btn" onClick={() => setEditing({ name: "" })} data-testid="button-add-class"><Plus size={15} /> New class</button></div>
      {data.classes.length === 0 ? <EmptyState icon={<School size={22} />} title="No classes yet" body="Create the school's classes first. Students, teachers and exams are all organised by class." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.classes.map((c) => (
            <div key={c.id} className="portal-card flex items-center justify-between p-5" data-testid={"card-class-" + c.id}>
              <div><p className="font-serif text-lg font-semibold">{c.name}</p>
                <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{data.students.filter((s) => s.classId === c.id && s.active).length} active students</p></div>
              <button className="portal-btn-ghost" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={"Rename " + c.name} data-testid={"button-edit-class-" + c.id}><Pencil size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{editing?.id ? "Rename class" : "New class"}</DialogTitle></DialogHeader>
          <Field label="Class name" htmlFor="class-name"><input id="class-name" className="portal-input" maxLength={100} value={editing?.name ?? ""} onChange={(e) => setEditing((p) => p && { ...p, name: e.target.value })} placeholder="e.g. Primary 4 Emerald" data-testid="input-class-name" /></Field>
          <DialogFooter><button className="portal-btn" onClick={save} disabled={cmd.pending || !editing?.name.trim()} data-testid="button-save-class">{cmd.pending ? "Saving..." : "Save class"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TempPasswordNotice({ login, onClose }: { login: IssuedLogin; onClose: () => void }) {
  const { toast } = useToast();
  const { studentId, password } = login;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Temporary password</DialogTitle>
          <DialogDescription>Give this to {studentId} privately. It is shown only once and the student must change it on first sign-in.</DialogDescription></DialogHeader>
        <div className="flex items-center gap-2 rounded-xl bg-[hsl(var(--p-ink))] p-4 font-mono text-lg tracking-wider text-[hsl(var(--p-gold))]" data-testid="text-temp-password">
          <span className="flex-1 break-all">{password}</span>
          <button className="portal-btn-dark" onClick={() => navigator.clipboard.writeText(password).then(() => toast({ title: "Copied" }), () => toast({ variant: "destructive", title: "Copy failed", description: "Select and copy the password manually." }))} aria-label="Copy password" data-testid="button-copy-password"><Copy size={14} /></button>
        </div>
        <DialogFooter className="gap-2">
          <button className="portal-btn-ghost" onClick={() => { if (!printLoginSlips([login])) toast({ variant: "destructive", title: "Pop-up blocked", description: "Allow pop-ups for this site to print." }); }} data-testid="button-print-slip"><Printer size={14} /> Print slip</button>
          <button className="portal-btn" onClick={onClose} data-testid="button-close-password">I have recorded it</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StudentsPanel({ data }: { data: PortalManagement }) {
  const cmd = useCommand();
  const [form, setForm] = useState<PortalManagementStudentsItem | null>(null);
  const [filter, setFilter] = useState(0);
  const [search, setSearch] = useState("");
  const [issued, setIssued] = useState<IssuedLogin | null>(null);
  const [bulk, setBulk] = useState(false);
  const list = data.students.filter((s) => (!filter || s.classId === filter) && (s.name + " " + s.studentId).toLowerCase().includes(search.toLowerCase()));

  const save = async () => {
    if (!form) return;
    const isNew = !form.id;
    const password = isNew ? generateTempPassword() : undefined;
    const student = { id: form.id, studentId: form.studentId.trim(), name: form.name.trim(), classId: form.classId, active: form.active, ...(password ? { password } : {}) };
    if (await cmd.run({ action: "saveStudent", student }, isNew ? "Student enrolled" : "Student updated")) {
      setForm(null);
      if (password) setIssued({ studentId: student.studentId.toUpperCase(), name: student.name, className: className(data.classes, student.classId), password });
    }
  };
  const resetPassword = async (s: PortalManagementStudentsItem) => {
    const password = generateTempPassword();
    if (await cmd.run({ action: "saveStudent", student: { id: s.id, studentId: s.studentId, name: s.name, classId: s.classId, active: s.active, password } }, "Password reset")) setIssued({ studentId: s.studentId, name: s.name, className: className(data.classes, s.classId), password });
  };
  const toggle = (s: PortalManagementStudentsItem) => cmd.run({ action: "saveStudent", student: { id: s.id, studentId: s.studentId, name: s.name, classId: s.classId, active: !s.active } }, s.active ? "Student deactivated" : "Student reactivated");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input className="portal-input sm:max-w-xs" placeholder="Search name or ID" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-students" />
        <select className="portal-input sm:max-w-[200px]" aria-label="Filter by class" value={filter} onChange={(e) => setFilter(Number(e.target.value))} data-testid="select-filter-class"><option value={0}>All classes</option>{data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="portal-btn-ghost sm:ml-auto" disabled={data.classes.length === 0} onClick={() => setBulk(true)} data-testid="button-bulk-enrol"><ListPlus size={15} /> Enrol class list</button>
        <button className="portal-btn" disabled={data.classes.length === 0} onClick={() => setForm({ studentId: "", name: "", classId: data.classes[0]?.id ?? 0, active: true })} data-testid="button-add-student"><Plus size={15} /> Enrol student</button>
      </div>
      {data.classes.length === 0 && <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">Create a class before enrolling students.</p>}
      {list.length === 0 ? <EmptyState icon={<GraduationCap size={22} />} title={data.students.length ? "No students match" : "No students enrolled"} body={data.students.length ? "Try another search or class filter." : "Enrol each student with a school-issued ID. A strong temporary password is generated for them."} /> : (
        <div className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden">
          {list.map((s) => (
            <div key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid={"row-student-" + s.id}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.name} {!s.active && <StatusPill tone="muted">Inactive</StatusPill>}</p>
                <p className="text-xs text-[hsl(var(--p-ink)/0.55)]"><span className="font-mono">{s.studentId}</span> / {className(data.classes, s.classId)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="portal-btn-ghost" onClick={() => setForm({ ...s })} data-testid={"button-edit-student-" + s.id}><Pencil size={13} /> Edit</button>
                <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => resetPassword(s)} data-testid={"button-reset-student-" + s.id}><KeyRound size={13} /> Reset password</button>
                <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => toggle(s)} data-testid={"button-toggle-student-" + s.id}>{s.active ? "Deactivate" : "Reactivate"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit student" : "Enrol student"}</DialogTitle>
            {form?.id && <DialogDescription>Student ID and class are fixed for an enrolment. For a class transfer, create a new enrolment and deactivate this one.</DialogDescription>}</DialogHeader>
          {form && <div className="space-y-4">
            <Field label="Student ID" htmlFor="st-id" hint={form.id ? undefined : "Used to sign in. Cannot be changed later."}><input id="st-id" className="portal-input font-mono" maxLength={50} disabled={!!form.id} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} data-testid="input-student-studentid" /></Field>
            <Field label="Full name" htmlFor="st-name"><input id="st-name" className="portal-input" maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-student-name" /></Field>
            <Field label="Class" htmlFor="st-class"><ClassSelect id="st-class" classes={data.classes} value={form.classId} disabled={!!form.id} onChange={(v) => setForm({ ...form, classId: v })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="checkbox-student-active" /> Active (can sign in)</label>
          </div>}
          <DialogFooter><button className="portal-btn" onClick={save} disabled={cmd.pending || !form?.studentId.trim() || !form?.name.trim() || !form?.classId} data-testid="button-save-student">{cmd.pending ? "Saving..." : form?.id ? "Save changes" : "Enrol and generate password"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
      {issued && <TempPasswordNotice login={issued} onClose={() => setIssued(null)} />}
      {bulk && <BulkEnrol data={data} onClose={() => setBulk(false)} />}
    </div>
  );
}

export function TeachersPanel({ data }: { data: PortalManagement }) {
  const cmd = useCommand();
  const [form, setForm] = useState<PortalManagementTeachersItem | null>(null);
  const save = async () => {
    if (!form) return;
    if (await cmd.run({ action: "saveTeacher", teacher: { ...form, email: form.email.trim().toLowerCase(), name: form.name.trim() } }, form.id ? "Teacher updated" : "Teacher approved")) setForm(null);
  };
  const toggleClass = (id: number) => form && setForm({ ...form, classIds: form.classIds.includes(id) ? form.classIds.filter((x) => x !== id) : [...form.classIds, id] });
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[hsl(var(--p-ink)/0.65)]">Teachers sign in with their school email and only see their assigned classes. Approval here never grants website administrator access.</p>
        <button className="portal-btn shrink-0" onClick={() => setForm({ email: "", name: "", classIds: [], active: true })} data-testid="button-add-teacher"><Plus size={15} /> Approve teacher</button>
      </div>
      {data.teachers.length === 0 ? <EmptyState icon={<Users size={22} />} title="No teachers approved" body="Add a teacher's email and choose the classes they teach. They can then sign in through staff sign-in." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.teachers.map((t) => (
            <div key={t.id} className="portal-card p-5" data-testid={"card-teacher-" + t.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-semibold">{t.name} {!t.active && <StatusPill tone="muted">Inactive</StatusPill>}</p><p className="truncate text-xs text-[hsl(var(--p-ink)/0.55)]">{t.email}</p></div>
                <UserCheck size={18} className={t.active ? "text-[hsl(var(--p-emerald))]" : "text-[hsl(var(--p-ink)/0.3)]"} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{t.classIds.length ? t.classIds.map((c) => <StatusPill key={c} tone="green">{className(data.classes, c)}</StatusPill>) : <span className="text-xs text-[hsl(var(--p-ink)/0.5)]">No classes assigned</span>}</div>
              <div className="mt-4 flex gap-2">
                <button className="portal-btn-ghost" onClick={() => setForm({ ...t })} data-testid={"button-edit-teacher-" + t.id}><Pencil size={13} /> Edit</button>
                <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => cmd.run({ action: "saveTeacher", teacher: { ...t, active: !t.active } }, t.active ? "Teacher deactivated" : "Teacher reactivated")} data-testid={"button-toggle-teacher-" + t.id}>{t.active ? "Deactivate" : "Reactivate"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit teacher" : "Approve teacher"}</DialogTitle></DialogHeader>
          {form && <div className="space-y-4">
            <Field label="School email" htmlFor="t-email"><input id="t-email" type="email" className="portal-input" maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-teacher-email" /></Field>
            <Field label="Name" htmlFor="t-name"><input id="t-name" className="portal-input" maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-teacher-name" /></Field>
            <fieldset><legend className="portal-label mb-2">Assigned classes</legend>
              <div className="grid grid-cols-2 gap-2">{data.classes.map((c) => <label key={c.id} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.7)] px-3 py-2 text-sm"><input type="checkbox" checked={form.classIds.includes(c.id as number)} onChange={() => toggleClass(c.id as number)} data-testid={"checkbox-teacher-class-" + c.id} />{c.name}</label>)}</div>
              {data.classes.length === 0 && <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">Create classes first.</p>}
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="checkbox-teacher-active" /> Active</label>
          </div>}
          <DialogFooter><button className="portal-btn" onClick={save} disabled={cmd.pending || !form || form.email.trim().length < 3 || !form.name.trim()} data-testid="button-save-teacher">{cmd.pending ? "Saving..." : "Save teacher"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
