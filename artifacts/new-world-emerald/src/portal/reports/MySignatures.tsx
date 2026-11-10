import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMySignaturesQueryKey, useGetMySignatures, useSaveMySignature, type SignatureEntry } from "@workspace/api-client-react";
import { PenLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ErrorPanel, Field, Skeleton } from "../ui";
import { errorMessage } from "../lib";
import { SignatureField } from "./ResultSettings";

const ROLE: Record<SignatureEntry["role"], { title: string; body: string }> = {
  head: { title: "Head Teacher", body: "Printed on every primary report card (Year 1 to 6). You approve and sign primary results." },
  director: { title: "Director", body: "Printed on every report card, primary and secondary." },
};

function SignatureCard({ entry }: { entry: SignatureEntry }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const save = useSaveMySignature();
  const [name, setName] = useState(entry.name);
  const [signature, setSignature] = useState<string | null>(entry.signature);
  useEffect(() => { setName(entry.name); setSignature(entry.signature); }, [entry.name, entry.signature]);
  const go = async () => {
    try {
      await save.mutateAsync({ data: { role: entry.role, name: name.trim(), signature } });
      toast({ title: "Signature saved", description: `It now prints on report cards as ${ROLE[entry.role].title}.` });
      await qc.invalidateQueries({ queryKey: getGetMySignaturesQueryKey() });
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  return (
    <section className="portal-card space-y-4 p-5" data-testid={`card-signature-${entry.role}`}>
      <div><h2 className="flex items-center gap-2 font-serif text-xl font-semibold"><PenLine size={17} aria-hidden="true" /> {ROLE[entry.role].title}'s signature</h2>
        <p className="mt-1 text-sm text-[hsl(var(--p-ink)/0.65)]">{ROLE[entry.role].body}</p></div>
      <Field label="Name as printed" htmlFor={`sig-name-${entry.role}`}><input id={`sig-name-${entry.role}`} className="portal-input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mrs. A. Okafor" data-testid={`input-signature-name-${entry.role}`} /></Field>
      <SignatureField label="Signature" value={signature} onChange={setSignature} testId={`signature-${entry.role}`} />
      <button type="button" className="portal-btn" disabled={save.isPending || !name.trim()} onClick={() => void go()} data-testid={`button-save-signature-${entry.role}`}>{save.isPending ? "Saving..." : "Save signature"}</button>
    </section>
  );
}

/** The Head Teacher's and the Director's own name and signature for report cards. */
export function MySignatures() {
  const q = useGetMySignatures();
  if (q.isLoading) return <Skeleton className="h-56" />;
  if (q.isError || !q.data) return <ErrorPanel title="Signatures did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data.entries.length) return null;
  return <div className="grid gap-4 lg:grid-cols-2">{q.data.entries.map((e) => <SignatureCard key={e.role} entry={e} />)}</div>;
}
