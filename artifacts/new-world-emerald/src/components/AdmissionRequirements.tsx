import { useEffect, useState } from "react";
import { AnimatedHeading } from "@/components/AnimatedHeading";
import { Check, FileText, HeartPulse, Lock } from "lucide-react";

const documents = [
  { key: "birth", title: "Birth certificate", desc: "Or a sworn declaration of age." },
  { key: "transfer", title: "Transfer document", desc: "From the child's previous school, if they are changing schools." },
  { key: "results", title: "Statement of results", desc: "The latest report card or result sheet from the previous school." },
  { key: "passport", title: "Two passport photographs", desc: "Recent colour photographs of the child." },
];
const medical = [
  { key: "medical", title: "Medical report", desc: "From a recognised hospital or clinic, signed and stamped." },
  { key: "blood", title: "Blood group", desc: "" },
  { key: "genotype", title: "Genotype", desc: "" },
  { key: "hepb", title: "Hepatitis B test", desc: "" },
  { key: "hiv", title: "HIV test", desc: "" },
  { key: "asthma", title: "Asthma status", desc: "Whether the child has asthma, and any inhaler or medicine they use." },
];
const ALL = [...documents, ...medical].map((d) => d.key);
const STORE = "nwe-admission-checklist";

/** What parents bring with an application, as a checklist they can tick off. All text is editable in Website content. */
export function AdmissionRequirements() {
  const [ready, setReady] = useState<string[]>([]);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(STORE) ?? "[]"); if (Array.isArray(saved)) setReady(saved.filter((k) => ALL.includes(k))); } catch { /* the checklist still works without storage */ }
  }, []);
  const toggle = (key: string) => setReady((r) => {
    const next = r.includes(key) ? r.filter((k) => k !== key) : [...r, key];
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* not remembered in private browsing */ }
    return next;
  });
  const row = (item: { key: string; title: string; desc: string }, n: number) => {
    const on = ready.includes(item.key);
    return (
      <li key={item.key}>
        <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(item.key)}
          className="flex w-full items-start gap-4 rounded-xl px-3 py-3 text-left transition-colors hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          data-testid={"requirement-" + item.key}>
          <span className={"mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold transition-colors " + (on ? "border-primary bg-primary text-primary-foreground" : "border-primary/30 text-primary")}>
            {on ? <Check size={15} aria-hidden="true" /> : n}
          </span>
          <span>
            <span className={"block font-semibold text-secondary " + (on ? "line-through decoration-primary/40" : "")}>{item.title}</span>
            {item.desc && <span className="mt-0.5 block text-sm leading-6 text-muted-foreground">{item.desc}</span>}
          </span>
        </button>
      </li>
    );
  };
  return (
    <section id="requirements" aria-labelledby="requirements-title" className="bg-[#f5f3e9] py-14 md:py-20" data-testid="section-admission-requirements">
      <div className="container mx-auto px-4 md:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Application requirements</p>
            <AnimatedHeading as="h2" id="requirements-title" className="font-serif text-3xl font-bold leading-tight text-secondary md:text-[2.4rem]">
              What to bring with <span className="text-primary">your application.</span>
            </AnimatedHeading>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              After you apply online, bring copies of these documents to the admissions office, with the originals for checking, on or before the entrance assessment day.
            </p>
          </div>
          <p className="shrink-0 self-start rounded-full md:self-auto bg-background px-4 py-2 text-sm font-semibold text-secondary shadow-sm" aria-live="polite" data-testid="text-requirements-progress">
            {ready.length} of {ALL.length} ready
          </p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-primary/10 bg-background p-5 md:p-7">
            <h3 className="flex items-center gap-3 font-serif text-2xl font-semibold text-secondary"><FileText aria-hidden="true" className="text-primary" size={22} /> Documents</h3>
            <ul className="mt-4 space-y-1">{documents.map((d, i) => row(d, i + 1))}</ul>
          </div>
          <div className="rounded-3xl border border-primary/10 bg-background p-5 md:p-7">
            <h3 className="flex items-center gap-3 font-serif text-2xl font-semibold text-secondary"><HeartPulse aria-hidden="true" className="text-primary" size={22} /> Medical report and test results</h3>
            <ul className="mt-4 space-y-1">{medical.map((d, i) => row(d, documents.length + i + 1))}</ul>
            <p className="mt-5 flex gap-3 rounded-2xl bg-primary/5 p-4 text-sm leading-6 text-secondary" data-testid="text-medical-privacy">
              <Lock aria-hidden="true" className="mt-0.5 shrink-0 text-primary" size={17} />
              <span>Medical results are confidential. Please bring them in a sealed envelope to the admissions office, and do not send them by email or WhatsApp.</span>
            </p>
          </div>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Missing something? Apply anyway and <a href="mailto:info@newworldemeraldprivateschool.com?subject=Admission%20documents" className="font-semibold text-primary underline-offset-4 hover:underline">tell the admissions office</a>; we will advise you.
        </p>
      </div>
    </section>
  );
}
