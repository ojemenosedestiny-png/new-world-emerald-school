import { Check, FileText, HeartPulse, Lock } from "lucide-react";

// The documents families bring after applying. Keys are stored with the application; text is editable in Website content.
export const ADMISSION_DOCUMENTS = [
  { key: "birth", group: "documents", title: "Birth certificate", desc: "Or a sworn declaration of age." },
  { key: "transfer", group: "documents", title: "Transfer document", desc: "From the child's previous school, if they are changing schools." },
  { key: "results", group: "documents", title: "Statement of results", desc: "The latest report card or result sheet from the previous school." },
  { key: "passport", group: "documents", title: "Two passport photographs", desc: "Recent colour photographs of the child." },
  { key: "medical", group: "medical", title: "Medical report", desc: "From a recognised hospital or clinic, signed and stamped." },
  { key: "blood", group: "medical", title: "Blood group", desc: "" },
  { key: "genotype", group: "medical", title: "Genotype", desc: "" },
  { key: "hepb", group: "medical", title: "Hepatitis B test", desc: "" },
  { key: "hiv", group: "medical", title: "HIV test", desc: "" },
  { key: "asthma", group: "medical", title: "Asthma status", desc: "Whether the child has asthma, and any inhaler or medicine they use." },
] as const;
export type AdmissionDocumentKey = (typeof ADMISSION_DOCUMENTS)[number]["key"];

/** The application form's document step: families tick what they already have. Nothing is uploaded. */
export function DocumentChecklist({ value, onChange }: { value: AdmissionDocumentKey[]; onChange: (next: AdmissionDocumentKey[]) => void }) {
  const toggle = (key: AdmissionDocumentKey) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  const group = (name: "documents" | "medical", title: string, Icon: typeof FileText) => (
    <div>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-secondary"><Icon aria-hidden="true" className="text-primary" size={17} /> {title}</p>
      <ul className="space-y-1">
        {ADMISSION_DOCUMENTS.filter((d) => d.group === name).map((d) => {
          const on = value.includes(d.key);
          return (
            <li key={d.key}>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-primary/5" data-testid={"document-" + d.key}>
                <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(d.key)} />
                <span className={"mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 " + (on ? "border-primary bg-primary text-primary-foreground" : "border-primary/35 bg-background")}>
                  {on && <Check size={13} aria-hidden="true" />}
                </span>
                <span className="text-sm">
                  <span className="font-medium text-foreground">{d.title}</span>
                  {d.desc && <span className="block text-xs leading-5 text-muted-foreground">{d.desc}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <fieldset className="rounded-2xl border border-border p-5" data-testid="fieldset-documents">
      <legend className="px-2 text-sm font-semibold">Documents to bring</legend>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          Tick the documents you already have. You do not upload anything here: bring copies, with the originals for checking, to the admissions office on or before the entrance assessment day.
        </p>
        <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary" aria-live="polite" data-testid="text-documents-ready">{value.length} of {ADMISSION_DOCUMENTS.length} ready</span>
      </div>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {group("documents", "Documents", FileText)}
        {group("medical", "Medical report and test results", HeartPulse)}
      </div>
      <p className="mt-4 flex gap-2.5 rounded-xl bg-muted p-3 text-xs leading-5 text-muted-foreground" data-testid="text-medical-privacy">
        <Lock aria-hidden="true" className="mt-0.5 shrink-0 text-primary" size={14} />
        <span>Medical results are confidential. Bring them in a sealed envelope to the admissions office, and do not send them by email or WhatsApp.</span>
      </p>
    </fieldset>
  );
}
