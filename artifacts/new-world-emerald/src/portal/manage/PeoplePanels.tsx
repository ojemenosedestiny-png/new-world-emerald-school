import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSetTeacherPhoto, useRemoveTeacherPhoto, getGetPortalManagementQueryKey, type PortalManagement, type PortalManagementStudentsItem, type PortalManagementTeachersItem } from "@workspace/api-client-react";
import { Activity, Camera, Copy, GraduationCap, KeyRound, Link2, ListPlus, Mail, Pencil, Plus, Printer, School, Trash2, UserCheck, Users, Wallet } from "lucide-react";
import type { AccountLinkResult } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, Field, StatusPill } from "../ui";
import { errorMessage, friendlyPassword } from "../lib";
import { Avatar, preparePhoto } from "../photos";
import { ClassSelect } from "./ClassSelect";
import { className, useCommand } from "./useCommand";
import { BulkEnrol } from "./BulkEnrol";
import { printLoginSlips, type IssuedLogin } from "./enrol";
import { StudentActivityDialogBody } from "../security/SecurityPanels";
import { OfficeFeeStatement } from "../FeeStatement";
import { AccountLinkDialog, EnrolStudentDialog, useAccountLink } from "./accounts";

export const SECONDARY_CLASSES = ["JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3"];

export function ClassesPanel({ data }: { data: PortalManagement }) {
  const cmd = useCommand();
  const [editing, setEditing] = useState<{ id?: number; name: string } | null>(null);
  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    if (await cmd.run({ action: "saveClass", schoolClass: { ...editing, name: editing.name.trim() } }, editing.id ? "Class renamed" : "Class created")) setEditing(null);
  };
  // Secondary school in one click: JSS 1 to SS 3, skipping any class that already exists (spacing and case ignored).
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  const missingSecondary = SECONDARY_CLASSES.filter((n) => !data.classes.some((c) => key(c.name) === key(n)));
  const addSecondary = async () => {
    for (const name of missingSecondary) if (!(await cmd.run({ action: "saveClass", schoolClass: { name } }, `${name} created`))) break;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {missingSecondary.length > 0 && <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => void addSecondary()} title={missingSecondary.join(", ")} data-testid="button-add-secondary"><Plus size={15} /> Add secondary classes ({missingSecondary.length})</button>}
        <button className="portal-btn" onClick={() => setEditing({ name: "" })} data-testid="button-add-class"><Plus size={15} /> New class</button>
      </div>
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
        <DialogHeader><DialogTitle className="font-serif text-2xl">Login details</DialogTitle>
          <DialogDescription>Give these to {login.name} privately; the password is shown only once. They can sign in straight away at the Student Portal and change the password there whenever they like.</DialogDescription></DialogHeader>
        <p className="rounded-xl bg-[hsl(var(--p-paper-2))] px-4 py-3 text-sm">Student ID: <b className="font-mono" data-testid="text-issued-student-id">{studentId}</b></p>
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

export function StudentsPanel({ data, isAdmin = true }: { data: PortalManagement; isAdmin?: boolean }) {
  const cmd = useCommand();
  const [form, setForm] = useState<PortalManagementStudentsItem | null>(null);
  const [filter, setFilter] = useState(0);
  const [search, setSearch] = useState("");
  const [issued, setIssued] = useState<IssuedLogin | null>(null);
  const [bulk, setBulk] = useState(false);
  const [activity, setActivity] = useState<{ id: number; name: string } | null>(null);
  const [fees, setFees] = useState<{ id: number; name: string } | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [link, setLink] = useState<{ result: AccountLinkResult; purpose: "activate" | "reset" } | null>(null);
  const accountLink = useAccountLink();
  const sendLink = async (s: PortalManagementStudentsItem, purpose: "activate" | "reset") => { const result = await accountLink.run(s.id as number, purpose); if (result) setLink({ result, purpose }); };
  const list = data.students.filter((s) => (!filter || s.classId === filter) && (s.name + " " + s.studentId).toLowerCase().includes(search.toLowerCase()));

  const save = async () => {
    if (!form) return;
    const isNew = !form.id;
    const password = isNew ? friendlyPassword() : undefined;
    const student = { id: form.id, studentId: form.studentId.trim(), name: form.name.trim(), classId: form.classId, active: form.active, guardianEmail: form.guardianEmail?.trim() || null, ...(password ? { password } : {}) };
    const res = await cmd.runForResult({ action: "saveStudent", student }, isNew ? "Student enrolled" : "Student updated");
    if (res) {
      setForm(null);
      if (password) setIssued({ studentId: res.studentId ?? student.studentId.toUpperCase(), name: student.name, className: className(data.classes, student.classId), password });
    }
  };
  const resetPassword = async (s: PortalManagementStudentsItem) => {
    const password = friendlyPassword();
    if (await cmd.run({ action: "saveStudent", student: { id: s.id, studentId: s.studentId, name: s.name, classId: s.classId, active: s.active, password } }, "New password issued")) setIssued({ studentId: s.studentId, name: s.name, className: className(data.classes, s.classId), password });
  };
  const toggle = (s: PortalManagementStudentsItem) => cmd.run({ action: "saveStudent", student: { id: s.id, studentId: s.studentId, name: s.name, classId: s.classId, active: !s.active } }, s.active ? "Student deactivated" : "Student reactivated");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input className="portal-input sm:max-w-xs" placeholder="Search name or ID" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-students" />
        <select className="portal-input sm:max-w-[200px]" aria-label="Filter by class" value={filter} onChange={(e) => setFilter(Number(e.target.value))} data-testid="select-filter-class"><option value={0}>All classes</option>{data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {isAdmin && <button className="portal-btn-ghost" disabled={data.classes.length === 0} onClick={() => setBulk(true)} data-testid="button-bulk-enrol"><ListPlus size={15} /> Enrol class list</button>}
          {isAdmin && <button className="portal-btn-ghost" disabled={data.classes.length === 0} onClick={() => setEnrolling(true)} data-testid="button-add-student"><Mail size={15} /> Enrol with parent email</button>}
          <button className="portal-btn" disabled={data.classes.length === 0} onClick={() => setForm({ studentId: "", name: "", classId: filter || data.classes[0]?.id || 0, active: true, guardianEmail: "" })} data-testid="button-enrol-password"><KeyRound size={15} /> Enrol with password</button>
        </div>
      </div>
      {data.classes.length === 0 && <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">Create a class before enrolling students.</p>}
      {list.length === 0 ? <EmptyState icon={<GraduationCap size={22} />} title={data.students.length ? "No students match" : "No students enrolled"} body={data.students.length ? "Try another search or class filter." : "Tap Enrol with password: a Student ID and an easy password are created for the student to sign in with straight away. No email is needed."} /> : (
        <div className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden">
          {list.map((s) => (
            <div key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid={"row-student-" + s.id}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 font-semibold">{s.name} {!s.active ? <StatusPill tone="muted">Inactive</StatusPill> : s.accountStatus === "pending" ? <StatusPill tone="gold">Pending activation</StatusPill> : <StatusPill tone="green">Active</StatusPill>}</p>
                <p className="text-xs text-[hsl(var(--p-ink)/0.55)]"><span className="font-mono">{s.studentId}</span> / {className(data.classes, s.classId)}{s.guardianEmail ? <> / <Mail size={11} className="inline" /> {s.guardianEmail}</> : ""}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {isAdmin && <button className="portal-btn-ghost" onClick={() => setForm({ ...s })} data-testid={"button-edit-student-" + s.id}><Pencil size={13} /> Edit</button>}
                {isAdmin && <button className="portal-btn-ghost" onClick={() => setActivity({ id: s.id as number, name: s.name })} data-testid={"button-activity-student-" + s.id}><Activity size={13} /> Activity</button>}
                {isAdmin && <button className="portal-btn-ghost" onClick={() => setFees({ id: s.id as number, name: s.name })} data-testid={"button-fees-student-" + s.id}><Wallet size={13} /> Fees</button>}
                {isAdmin && s.active && (s.accountStatus === "pending"
                  ? <button className="portal-btn-ghost" disabled={accountLink.pending} onClick={() => void sendLink(s, "activate")} data-testid={"button-activation-link-" + s.id}><Link2 size={13} /> Activation link</button>
                  : <button className="portal-btn-ghost" disabled={accountLink.pending} onClick={() => void sendLink(s, "reset")} data-testid={"button-reset-link-" + s.id}><Mail size={13} /> Reset link</button>)}
                {s.active && <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => resetPassword(s)} data-testid={"button-reset-student-" + s.id}><KeyRound size={13} /> New password</button>}
                {isAdmin && <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => toggle(s)} data-testid={"button-toggle-student-" + s.id}>{s.active ? "Deactivate" : "Reactivate"}</button>}
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
            <Field label="Student ID" htmlFor="st-id" hint={form.id ? undefined : "Leave empty to create one automatically (like NWE/2026/00012). Used to sign in; cannot be changed later."}><input id="st-id" className="portal-input font-mono" maxLength={50} disabled={!!form.id} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} data-testid="input-student-studentid" /></Field>
            <Field label="Full name" htmlFor="st-name"><input id="st-name" className="portal-input" maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-student-name" /></Field>
            <Field label="Class" htmlFor="st-class"><ClassSelect id="st-class" classes={data.classes} value={form.classId} disabled={!!form.id} onChange={(v) => setForm({ ...form, classId: v })} /></Field>
            <Field label="Parent email (optional)" htmlFor="st-email" hint="Not needed. If given, the family can also reset a forgotten password by email."><input id="st-email" type="email" className="portal-input" maxLength={200} value={form.guardianEmail ?? ""} onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })} data-testid="input-student-email" /></Field>
            {isAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="checkbox-student-active" /> Active (can sign in)</label>}
          </div>}
          <DialogFooter><button className="portal-btn" onClick={save} disabled={cmd.pending || (!!form?.id && !form?.studentId.trim()) || !form?.name.trim() || !form?.classId} data-testid="button-save-student">{cmd.pending ? "Saving..." : form?.id ? "Save changes" : "Enrol and generate password"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
      {issued && <TempPasswordNotice login={issued} onClose={() => setIssued(null)} />}
      {bulk && <BulkEnrol data={data} onClose={() => setBulk(false)} />}
      {enrolling && <EnrolStudentDialog data={data} onClose={() => setEnrolling(false)} onDone={(result) => { setEnrolling(false); setLink({ result, purpose: "activate" }); }} />}
      {link && <AccountLinkDialog result={link.result} purpose={link.purpose} onClose={() => setLink(null)} />}
      <Dialog open={!!activity} onOpenChange={(o) => !o && setActivity(null)}>
        <DialogContent className="portal !min-h-0 max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{activity?.name}</DialogTitle><DialogDescription>Sign-in history and active sessions</DialogDescription></DialogHeader>
          {activity && <StudentActivityDialogBody studentId={activity.id} name={activity.name} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!fees} onOpenChange={(o) => !o && setFees(null)}>
        <DialogContent className="portal !min-h-0 max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{fees?.name}</DialogTitle><DialogDescription>Fee statement from class fees, individual charges and payment reports</DialogDescription></DialogHeader>
          {fees && <OfficeFeeStatement studentId={fees.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Staff portrait for the student directory: upload, replace or remove. */
function TeacherPhoto({ teacher }: { teacher: PortalManagementTeachersItem }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const set = useSetTeacherPhoto();
  const remove = useRemoveTeacherPhoto();
  const input = useRef<HTMLInputElement>(null);
  const busy = set.isPending || remove.isPending;
  const done = () => queryClient.invalidateQueries({ queryKey: getGetPortalManagementQueryKey() });
  const choose = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file || teacher.id == null) return;
    try { await set.mutateAsync({ id: teacher.id, data: await preparePhoto(file, 800) }); toast({ title: "Staff photo saved" }); await done(); }
    catch (e) { toast({ variant: "destructive", title: "Photo not uploaded", description: errorMessage(e) }); }
  };
  const clear = async () => {
    if (teacher.id == null) return;
    try { await remove.mutateAsync({ id: teacher.id }); toast({ title: "Staff photo removed" }); await done(); }
    catch (e) { toast({ variant: "destructive", title: "Not removed", description: errorMessage(e) }); }
  };
  return (
    <div className="flex items-center gap-2">
      <Avatar name={teacher.name} photoId={teacher.photoFileId} size={40} className="bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]" />
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} data-testid={"input-teacher-photo-" + teacher.id} />
      <button className="portal-btn-ghost" disabled={busy} onClick={() => input.current?.click()} data-testid={"button-teacher-photo-" + teacher.id}><Camera size={13} /> {set.isPending ? "Uploading..." : teacher.photoFileId ? "Change photo" : "Add photo"}</button>
      {teacher.photoFileId && <button className="portal-btn-ghost" disabled={busy} onClick={() => void clear()} aria-label="Remove photo"><Trash2 size={13} /></button>}
    </div>
  );
}

/** The address teachers use to sign in, with a copy button for sharing on WhatsApp or email. */
export function TeacherLink() {
  const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/teacher`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the link is shown to copy by hand */ }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[hsl(var(--p-emerald-soft))] px-3 py-2 text-sm" data-testid="panel-teacher-link">
      <span className="font-semibold text-[hsl(var(--p-emerald))]">Teacher sign-in link</span>
      <code className="min-w-0 break-all font-mono text-xs" data-testid="text-teacher-link">{url}</code>
      <button type="button" className="portal-btn-ghost !px-2.5 !py-1 text-xs" onClick={() => void copy()} data-testid="button-copy-teacher-link"><Copy size={12} /> {copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

export function TeachersPanel({ data }: { data: PortalManagement }) {
  const cmd = useCommand();
  const [form, setFormState] = useState<PortalManagementTeachersItem | null>(null);
  const [subjectsText, setSubjectsText] = useState("");
  const setForm = (next: PortalManagementTeachersItem | null) => {
    // Opening the dialog (or switching teacher) loads that teacher's subjects into the text box.
    if (next && (!form || next.id !== form.id)) setSubjectsText((next.subjects ?? []).join(", "));
    setFormState(next);
  };
  const save = async () => {
    if (!form) return;
    const subjects = subjectsText.split(",").map((s) => s.trim()).filter(Boolean);
    if (await cmd.run({ action: "saveTeacher", teacher: { ...form, email: form.email.trim().toLowerCase(), name: form.name.trim(), title: (form.title ?? "").trim(), subjects } }, form.id ? "Teacher updated" : "Teacher approved")) setForm(null);
  };
  const toggleClass = (id: number) => form && setForm({ ...form, classIds: form.classIds.includes(id) ? form.classIds.filter((x) => x !== id) : [...form.classIds, id] });
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-xl space-y-2">
          <p className="text-sm text-[hsl(var(--p-ink)/0.65)]">Teachers sign in with their school email and only see their assigned classes. Approving a teacher emails them this link and their classes. Approval here never grants website administrator access.</p>
          <TeacherLink />
        </div>
        <button className="portal-btn shrink-0" onClick={() => setForm({ email: "", name: "", classIds: [], active: true, title: "", subjects: [], showInDirectory: true })} data-testid="button-add-teacher"><Plus size={15} /> Approve teacher</button>
      </div>
      {data.teachers.length === 0 ? <EmptyState icon={<Users size={22} />} title="No teachers approved" body="Add a teacher's email and choose the classes they teach. They can then sign in through staff sign-in." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.teachers.map((t) => (
            <div key={t.id} className="portal-card p-5" data-testid={"card-teacher-" + t.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-semibold">{t.name} {!t.active && <StatusPill tone="muted">Inactive</StatusPill>} {t.active && t.showInDirectory === false && <StatusPill tone="muted">Hidden from directory</StatusPill>}</p><p className="truncate text-xs text-[hsl(var(--p-ink)/0.55)]">{t.title ? t.title + " / " : ""}{t.email}</p>{!!t.subjects?.length && <p className="truncate text-xs text-[hsl(var(--p-ink)/0.55)]">{t.subjects.join(", ")}</p>}</div>
                <UserCheck size={18} className={t.active ? "text-[hsl(var(--p-emerald))]" : "text-[hsl(var(--p-ink)/0.3)]"} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{t.classIds.length ? t.classIds.map((c) => <StatusPill key={c} tone="green">{className(data.classes, c)}</StatusPill>) : <span className="text-xs text-[hsl(var(--p-ink)/0.5)]">No classes assigned</span>}</div>
              <div className="mt-3"><TeacherPhoto teacher={t} /></div>
              <div className="mt-4 flex gap-2">
                <button className="portal-btn-ghost" onClick={() => setForm({ ...t })} data-testid={"button-edit-teacher-" + t.id}><Pencil size={13} /> Edit</button>
                {t.active && <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => void cmd.run({ action: "inviteTeacher", target: { id: t.id as number } }, "Invitation")} data-testid={"button-invite-teacher-" + t.id}><Mail size={13} /> Send invite</button>}
                <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => cmd.run({ action: "saveTeacher", teacher: { ...t, active: !t.active } }, t.active ? "Teacher deactivated" : "Teacher reactivated")} data-testid={"button-toggle-teacher-" + t.id}>{t.active ? "Deactivate" : "Reactivate"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit teacher" : "Approve teacher"}</DialogTitle></DialogHeader>
          {form && <div className="space-y-4">
            <Field label="School email" htmlFor="t-email"><input id="t-email" type="email" className="portal-input" maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-teacher-email" /></Field>
            <Field label="Name" htmlFor="t-name"><input id="t-name" className="portal-input" maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-teacher-name" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role (shown to students)" htmlFor="t-title"><input id="t-title" className="portal-input" maxLength={80} placeholder="e.g. Class Teacher" value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-teacher-title" /></Field>
              <Field label="Subjects (comma separated)" htmlFor="t-subjects"><input id="t-subjects" className="portal-input" maxLength={600} placeholder="Mathematics, Basic Science" value={subjectsText} onChange={(e) => setSubjectsText(e.target.value)} data-testid="input-teacher-subjects" /></Field>
            </div>
            <fieldset><legend className="portal-label mb-2">Assigned classes</legend>
              <div className="grid grid-cols-2 gap-2">{data.classes.map((c) => <label key={c.id} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.7)] px-3 py-2 text-sm"><input type="checkbox" checked={form.classIds.includes(c.id as number)} onChange={() => toggleClass(c.id as number)} data-testid={"checkbox-teacher-class-" + c.id} />{c.name}</label>)}</div>
              {data.classes.length === 0 && <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">Create classes first.</p>}
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="checkbox-teacher-active" /> Active</label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={form.showInDirectory !== false} onChange={(e) => setForm({ ...form, showInDirectory: e.target.checked })} data-testid="checkbox-teacher-directory" /> <span>Show in the student staff directory <span className="block text-xs text-[hsl(var(--p-ink)/0.55)]">Students see the name, role, subjects and classes. Never the email.</span></span></label>
          </div>}
          <DialogFooter><button className="portal-btn" onClick={save} disabled={cmd.pending || !form || form.email.trim().length < 3 || !form.name.trim()} data-testid="button-save-teacher">{cmd.pending ? "Saving..." : "Save teacher"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
