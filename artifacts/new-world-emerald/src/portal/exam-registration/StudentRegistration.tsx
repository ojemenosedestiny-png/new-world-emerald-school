import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyExamRegistrationQueryKey, useGetMyExamRegistration, useSaveMyExamRegistration, type ExamRegistrationFormFields, type MyExamRegistration } from "@workspace/api-client-react";
import { CheckCircle2, Clock3, GraduationCap, Lock, Printer, Save, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Field, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { AccountCard } from "../payments/ParentTransfers";
import { ngn } from "../payments/transfers";
import { printRegistrationForm } from "./print";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const EMPTY: ExamRegistrationFormFields = { surname: "", firstName: "", middleName: "", dateOfBirth: "", stateOfOrigin: "", lga: "", gender: "", nin: "", subjects: [], phone: "", email: "", signatureName: "" };
export const NIGERIAN_STATES = ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"];

/** The fields from a saved form, or a fresh one with the compulsory subjects filled in. */
function startFrom(d: MyExamRegistration): ExamRegistrationFormFields {
  if (d.form) { const { surname, firstName, middleName, dateOfBirth, stateOfOrigin, lga, gender, nin, subjects, phone, email, signatureName } = d.form; return { surname, firstName, middleName, dateOfBirth, stateOfOrigin, lga, gender, nin, subjects, phone, email, signatureName }; }
  return { ...EMPTY, subjects: [...(d.settings?.compulsorySubjects ?? [])] };
}

/** The SS 3 student's WAEC/NECO registration form: fill it any time, submit it once the fee is confirmed. */
export function StudentRegistration() {
  const q = useGetMyExamRegistration({ query: { queryKey: getGetMyExamRegistrationQueryKey() } });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <ErrorPanel title="Registration did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data.settings) return <EmptyState icon={<GraduationCap size={22} />} title="Registration is not open" body="When the school opens WAEC and NECO registration for your class, the form appears here." />;
  return <RegistrationForm key={q.data.form?.updatedAt ?? "new"} data={q.data} />;
}

function RegistrationForm({ data }: { data: MyExamRegistration }) {
  const s = data.settings!;
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useSaveMyExamRegistration();
  const [f, setF] = useState<ExamRegistrationFormFields>(() => startFrom(data));
  useEffect(() => { setF(startFrom(data)); }, [data]);
  const submitted = data.form?.status === "submitted";
  const locked = submitted || !data.eligible;
  const paid = !data.fee || data.fee.status === "paid";
  const optional = f.subjects.filter((x) => !s.compulsorySubjects.includes(x));
  const room = s.maxSubjects - s.compulsorySubjects.length;
  const set = <K extends keyof ExamRegistrationFormFields>(k: K, v: ExamRegistrationFormFields[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const toggle = (subject: string) => set("subjects", f.subjects.includes(subject) ? f.subjects.filter((x) => x !== subject) : optional.length >= room ? f.subjects : [...f.subjects, subject]);
  const send = async (submit: boolean) => {
    try {
      const r = await save.mutateAsync({ data: { ...f, subjects: [...s.compulsorySubjects, ...optional], submit } });
      qc.setQueryData(getGetMyExamRegistrationQueryKey(), r);
      toast({ title: submit ? "Form submitted" : "Saved", description: submit ? "The school has your WAEC/NECO registration." : "You can come back and finish it." });
    } catch (e) { toast({ variant: "destructive", title: submit ? "Not submitted" : "Not saved", description: errorMessage(e) }); }
  };
  const input = (k: "surname" | "firstName" | "middleName" | "lga" | "phone" | "email" | "signatureName" | "nin", label: string, props: Record<string, unknown> = {}, hint?: string) => (
    <Field label={label} htmlFor={`reg-${k}`} hint={hint}><input id={`reg-${k}`} className="portal-input" disabled={locked} value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`input-reg-${k}`} {...props} /></Field>
  );
  return (
    <div className="space-y-5">
      <section className="portal-hero rounded-3xl p-6 sm:p-8" aria-labelledby="reg-title">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold))]">{data.student.className} · {s.academicYear}</p>
        <h2 id="reg-title" className="mt-2 font-serif text-3xl font-semibold">{s.title}</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Form</p><p className="mt-1 font-serif text-2xl font-semibold" data-testid="text-reg-status">{submitted ? "Submitted" : data.form?.status === "returned" ? "Needs a correction" : data.form ? "Draft saved" : "Not started"}</p></div>
          <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Registration fee</p><p className="mt-1 font-serif text-2xl font-semibold tabular-nums">{data.fee ? ngn(data.fee.amountKobo) : "Free"}</p></div>
          <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Payment</p><p className="mt-1 font-serif text-2xl font-semibold" data-testid="text-reg-fee-status">{paid ? "Paid" : data.fee?.status === "pending" ? "Being checked" : "Not paid"}</p></div>
        </div>
        {s.deadline && <p className="mt-4 text-sm text-white/75">Closing date: {new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(s.deadline + "T12:00:00Z"))}</p>}
      </section>

      {data.form?.status === "returned" && data.form.officeNote && <p className="rounded-xl bg-[hsl(var(--p-gold-soft))] px-4 py-3 text-sm text-[hsl(var(--p-gold-ink))]" role="alert"><b>The school sent your form back:</b> {data.form.officeNote}</p>}
      {!paid && (
        <section className="portal-card grid gap-4 p-5 md:grid-cols-[1fr_22rem] md:items-start" aria-labelledby="fee-title">
          <div><h3 id="fee-title" className="flex items-center gap-2 font-serif text-xl font-semibold"><Clock3 size={18} aria-hidden="true" /> Pay the fee before you submit</h3>
            <p className={"mt-1 text-sm " + MUTED}>{data.fee?.status === "pending" ? "Your parent has sent the payment. The school is checking it; you can submit once it is confirmed." : `Your parent pays ${data.fee ? ngn(data.fee.amountKobo) : ""} by bank transfer into the WAEC/NECO account, from the parent portal (Fees and WAEC/NECO). You can fill and save the form now.`}</p></div>
          <AccountCard account={data.account ?? null} purpose="exam_registration" />
        </section>
      )}

      <section className="portal-card space-y-5 p-5 sm:p-7" aria-labelledby="form-title">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="form-title" className="font-serif text-2xl font-semibold">Candidate details</h3>
          {submitted && <span className="flex items-center gap-2"><StatusPill tone="green"><Lock size={10} /> Submitted</StatusPill><button type="button" className="portal-btn-ghost !min-h-[32px] !px-3 text-xs" onClick={() => printRegistrationForm({ ...f, studentName: data.student.name, studentCode: data.student.studentId, className: data.student.className, academicYear: s.academicYear, title: s.title, submittedAt: data.form?.submittedAt ?? null })}><Printer size={13} aria-hidden="true" /> Print</button></span>}</div>
        <p className={"text-sm " + MUTED}>Write your names exactly as on your birth certificate. WAEC and NECO use them on your certificate.</p>
        <div className="grid gap-4 sm:grid-cols-3">{input("surname", "Surname", { autoComplete: "family-name", maxLength: 60 })}{input("firstName", "First name", { autoComplete: "given-name", maxLength: 60 })}{input("middleName", "Middle name", { maxLength: 60 }, "If you have one")}</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date of birth" htmlFor="reg-dob"><input id="reg-dob" type="date" className="portal-input" disabled={locked} value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} data-testid="input-reg-dob" /></Field>
          <Field label="Gender" htmlFor="reg-gender"><select id="reg-gender" className="portal-input" disabled={locked} value={f.gender} onChange={(e) => set("gender", e.target.value)} data-testid="input-reg-gender"><option value="">Choose</option><option>Male</option><option>Female</option></select></Field>
          {input("nin", "NIN", { inputMode: "numeric", maxLength: 11 }, "National Identification Number, 11 digits")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="State of origin" htmlFor="reg-state"><select id="reg-state" className="portal-input" disabled={locked} value={f.stateOfOrigin} onChange={(e) => set("stateOfOrigin", e.target.value)} data-testid="input-reg-state"><option value="">Choose your state</option>{NIGERIAN_STATES.map((x) => <option key={x}>{x}</option>)}</select></Field>
          {input("lga", "Local government area (LGA)", { maxLength: 60 })}
        </div>

        <fieldset>
          <legend className="font-serif text-xl font-semibold">Subjects</legend>
          <p className={"text-sm " + MUTED}>{s.compulsorySubjects.length} compulsory subjects are already in. Choose up to {room} more ({f.subjects.length} of {s.maxSubjects}).</p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="list-reg-subjects">
            {[...s.compulsorySubjects, ...optional].map((x, i) => <li key={x} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--p-line))] px-3 py-2 text-sm"><span className="grid h-7 w-7 place-items-center rounded-full bg-[hsl(var(--p-emerald-soft))] text-xs font-bold text-[hsl(var(--p-emerald))]">{i + 1}</span><span className="flex-1 font-semibold">{x}</span>{s.compulsorySubjects.includes(x) ? <span className={"text-xs " + MUTED}>Compulsory</span> : !locked && <button type="button" className="text-xs font-semibold text-[hsl(var(--p-red))]" onClick={() => toggle(x)}>Remove</button>}</li>)}
          </ol>
          {!locked && <div className="mt-3 flex flex-wrap gap-2">{s.optionalSubjects.filter((x) => !optional.includes(x)).map((x) => <button key={x} type="button" disabled={optional.length >= room} onClick={() => toggle(x)} className="rounded-full border border-[hsl(var(--p-line))] px-3 py-1.5 text-sm hover:border-[hsl(var(--p-emerald))] disabled:opacity-40" data-testid={`button-subject-${x}`}>+ {x}</button>)}</div>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">{input("phone", "Phone number", { type: "tel", autoComplete: "tel", maxLength: 20 })}{input("email", "Email address", { type: "email", autoComplete: "email", maxLength: 120 })}</div>
        {input("signatureName", "Signature: type your full name", { maxLength: 120 }, "By typing your name you confirm these details are correct")}

        {!locked && <div className="flex flex-wrap justify-end gap-2 border-t border-[hsl(var(--p-line))] pt-4">
          <button type="button" className="portal-btn-ghost" disabled={save.isPending} onClick={() => void send(false)} data-testid="button-reg-save"><Save size={15} aria-hidden="true" /> Save draft</button>
          <button type="button" className="portal-btn" disabled={save.isPending || !paid} title={!paid ? "The fee must be paid and confirmed first" : undefined} onClick={() => void send(true)} data-testid="button-reg-submit"><Send size={15} aria-hidden="true" /> Submit to the school</button>
        </div>}
        {submitted && <p className="flex items-center gap-2 text-sm text-[hsl(var(--p-emerald))]"><CheckCircle2 size={16} aria-hidden="true" /> Submitted. If something must change, ask the school office to send the form back to you.</p>}
      </section>
    </div>
  );
}
