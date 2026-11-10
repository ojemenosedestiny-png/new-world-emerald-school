import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetStudentProfileQueryKey, useGetChildProfile, useGetMyStudentProfile, useGetStudentProfile, useSaveStudentProfile,
  type StudentProfileFields, type StudentProfileView,
} from "@workspace/api-client-react";
import { Cake, HeartPulse, Home, Loader2, Pencil, Phone, School, ShieldAlert, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { Avatar } from "../photos";
import { NIGERIAN_STATES } from "../exam-registration/StudentRegistration";

type Key = keyof StudentProfileFields;
type FieldDef = { key: Key; label: string; kind?: "date" | "tel" | "select" | "textarea"; options?: string[]; placeholder?: string; wide?: boolean };
const SECTIONS: { title: string; icon: typeof Home; fields: FieldDef[] }[] = [
  { title: "Personal details", icon: Cake, fields: [
    { key: "dateOfBirth", label: "Date of birth", kind: "date" }, { key: "gender", label: "Gender", kind: "select", options: ["Male", "Female"] },
    { key: "stateOfOrigin", label: "State of origin", kind: "select", options: NIGERIAN_STATES }, { key: "lga", label: "LGA" },
    { key: "nationality", label: "Nationality", placeholder: "Nigerian" }, { key: "religion", label: "Religion", kind: "select", options: ["Christianity", "Islam", "Other"] },
  ] },
  { title: "Home and contact", icon: Home, fields: [
    { key: "address", label: "Home address", wide: true, placeholder: "House number, street, area" }, { key: "city", label: "Town / city", placeholder: "Kubwa, Abuja" },
    { key: "phone", label: "Phone number", kind: "tel", placeholder: "0803 123 4567" },
  ] },
  { title: "Parents and guardians", icon: Users, fields: [
    { key: "parent1Name", label: "Parent / guardian 1" }, { key: "parent1Relationship", label: "Relationship", kind: "select", options: ["Father", "Mother", "Guardian", "Other"] },
    { key: "parent1Phone", label: "Phone", kind: "tel" }, { key: "parent1Occupation", label: "Occupation" },
    { key: "parent2Name", label: "Parent / guardian 2" }, { key: "parent2Relationship", label: "Relationship", kind: "select", options: ["Father", "Mother", "Guardian", "Other"] },
    { key: "parent2Phone", label: "Phone", kind: "tel" }, { key: "parent2Occupation", label: "Occupation" },
  ] },
  { title: "Emergency contact", icon: ShieldAlert, fields: [{ key: "emergencyName", label: "Name" }, { key: "emergencyPhone", label: "Phone", kind: "tel" }] },
  { title: "Health", icon: HeartPulse, fields: [
    { key: "bloodGroup", label: "Blood group", kind: "select", options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
    { key: "genotype", label: "Genotype", kind: "select", options: ["AA", "AS", "AC", "SS", "SC"] },
    { key: "medicalNotes", label: "Allergies and medical notes", kind: "textarea", wide: true },
  ] },
  { title: "Admission", icon: School, fields: [{ key: "admissionDate", label: "Admission date", kind: "date" }, { key: "previousSchool", label: "Previous school" }] },
];
const MUTED = "text-[hsl(var(--p-ink)/0.6)]";
const longDate = (d: string) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00Z")) : "");
function age(dob: string) {
  if (!dob) return null;
  const b = new Date(dob + "T12:00:00Z"), now = new Date();
  let a = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) a -= 1;
  return a >= 0 && a < 40 ? a : null;
}
const shown = (f: FieldDef, v: string) => (f.kind === "date" ? longDate(v) : v);

/** The profile as a card: photo, name, ID and class at the top, then each section of details. */
export function ProfileDetails({ p, action }: { p: StudentProfileView; action?: ReactNode }) {
  const years = age(p.profile.dateOfBirth ?? "");
  const filled = SECTIONS.flatMap((s) => s.fields).filter((f) => (p.profile[f.key] ?? "").trim()).length;
  return (
    <div className="space-y-4" data-testid="student-profile">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-[hsl(var(--p-emerald)/0.08)] p-4">
        <Avatar name={p.name} photoId={p.photoImageId} size={72} />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-2xl font-semibold leading-tight" data-testid="text-profile-name">{p.name}</p>
          <p className={"text-sm " + MUTED}><span className="font-mono">{p.studentId}</span> · {p.className}{years !== null ? ` · ${years} years old` : ""}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{!p.active && <StatusPill tone="muted">Inactive</StatusPill>}{[p.guardianEmail, p.secondGuardianEmail].filter(Boolean).map((e) => <StatusPill key={e} tone="ink">{e}</StatusPill>)}</div>
        </div>
        {action}
      </div>
      {filled === 0 && <p className={"rounded-xl border border-dashed border-[hsl(var(--p-line))] p-4 text-center text-sm " + MUTED}>No details yet.{p.canEdit ? " Press Edit details to add them." : " The school office adds them."}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => {
          const rows = s.fields.filter((f) => (p.profile[f.key] ?? "").trim());
          if (!rows.length) return null;
          return (
            <section key={s.title} className="rounded-2xl border border-[hsl(var(--p-line))] p-4" aria-label={s.title}>
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--p-emerald))]"><s.icon size={14} aria-hidden="true" /> {s.title}</h3>
              <dl className="mt-2 space-y-1.5 text-sm">{rows.map((f) => (
                <div key={f.key} className="flex justify-between gap-3"><dt className={MUTED}>{f.label}</dt>
                  <dd className="text-right font-medium">{f.kind === "tel" ? <a className="inline-flex items-center gap-1 underline-offset-2 hover:underline" href={`tel:${(p.profile[f.key] ?? "").replace(/[^\d+]/g, "")}`}><Phone size={12} aria-hidden="true" />{p.profile[f.key]}</a> : shown(f, p.profile[f.key] ?? "")}</dd></div>
              ))}</dl>
            </section>
          );
        })}
      </div>
      {p.updatedAt && <p className={"text-xs " + MUTED}>Last updated {new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium" }).format(new Date(p.updatedAt))}{p.updatedBy ? ` by ${p.updatedBy}` : ""}</p>}
    </div>
  );
}

/** Staff fill in or correct the details. */
function ProfileForm({ p, onDone }: { p: StudentProfileView; onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const save = useSaveStudentProfile();
  const [f, setF] = useState<StudentProfileFields>({ ...p.profile });
  const set = (k: Key, v: string) => setF((x) => ({ ...x, [k]: v }));
  const today = new Date().toISOString().slice(0, 10);
  const go = async () => {
    try {
      await save.mutateAsync({ id: p.id, data: f });
      toast({ title: "Profile saved", description: `${p.name}'s details are up to date.` });
      await qc.invalidateQueries({ queryKey: getGetStudentProfileQueryKey(p.id) });
      onDone();
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  return (
    <div className="space-y-5">
      {SECTIONS.map((s) => (
        <fieldset key={s.title} className="rounded-2xl border border-[hsl(var(--p-line))] p-4">
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--p-emerald))]"><s.icon size={14} aria-hidden="true" /> {s.title}</legend>
          <div className="grid gap-3 sm:grid-cols-2">{s.fields.map((d) => {
            const id = `pf-${d.key}`;
            const v = f[d.key] ?? "";
            const common = { id, className: "portal-input mt-1", "data-testid": `input-profile-${d.key}` };
            return (
              <label key={d.key} htmlFor={id} className={"block text-sm font-semibold " + (d.wide ? "sm:col-span-2" : "")}>{d.label}
                {d.kind === "select" ? <select {...common} value={v} onChange={(e) => set(d.key, e.target.value)}><option value="">Not given</option>{d.options!.map((o) => <option key={o}>{o}</option>)}</select>
                  : d.kind === "textarea" ? <textarea {...common} className="portal-input mt-1 min-h-[70px]" maxLength={1000} value={v} onChange={(e) => set(d.key, e.target.value)} />
                  : <input {...common} type={d.kind === "date" ? "date" : d.kind === "tel" ? "tel" : "text"} inputMode={d.kind === "tel" ? "tel" : undefined} max={d.kind === "date" ? today : undefined} maxLength={d.key === "address" ? 300 : 150} placeholder={d.placeholder} value={v} onChange={(e) => set(d.key, e.target.value)} />}
              </label>
            );
          })}</div>
        </fieldset>
      ))}
      <div className="flex justify-end gap-2">
        <button type="button" className="portal-btn-ghost" onClick={onDone}>Cancel</button>
        <button type="button" className="portal-btn" disabled={save.isPending} onClick={() => void go()} data-testid="button-save-profile">{save.isPending && <Loader2 size={15} className="animate-spin" />} Save details</button>
      </div>
    </div>
  );
}

/** Staff: a student's profile in a dialog, with an editor. */
export function StudentProfileDialog({ studentId, onClose }: { studentId: number | null; onClose: () => void }) {
  const q = useGetStudentProfile(studentId ?? 0, { query: { enabled: !!studentId, queryKey: getGetStudentProfileQueryKey(studentId ?? 0) } });
  const [editing, setEditing] = useState(false);
  const close = () => { setEditing(false); onClose(); };
  return (
    <Dialog open={!!studentId} onOpenChange={(o) => !o && close()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{editing ? "Edit student details" : "Student profile"}</DialogTitle></DialogHeader>
        {q.isLoading ? <Skeleton className="h-64" /> : q.isError || !q.data ? <ErrorPanel title="The profile did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
          : editing ? <ProfileForm p={q.data} onDone={() => setEditing(false)} />
          : <ProfileDetails p={q.data} action={q.data.canEdit && <button type="button" className="portal-btn" onClick={() => setEditing(true)} data-testid="button-edit-profile"><Pencil size={14} /> Edit details</button>} />}
      </DialogContent>
    </Dialog>
  );
}

/** The student's own profile. */
export function MyProfile() {
  const q = useGetMyStudentProfile();
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <ErrorPanel title="Your profile did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <><ProfileDetails p={q.data} /><p className={"mt-3 text-xs " + MUTED}>Something wrong or missing? Tell your class teacher or the school office.</p></>;
}

/** A parent's view of one child's profile. */
export function ChildProfile({ studentId }: { studentId: number }) {
  const q = useGetChildProfile(studentId);
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data) return <ErrorPanel title="The profile did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <><ProfileDetails p={q.data} /><p className={"mt-3 text-xs " + MUTED}>To correct any detail, contact the school office.</p></>;
}
