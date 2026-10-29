import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListDirectorBroadcasts, getListDirectorBroadcastsQueryKey, useSendDirectorBroadcast, type DirectorBroadcastInputAudience } from "@workspace/api-client-react";
import { Mail, Send, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ErrorPanel, Field, Skeleton } from "@/portal/ui";
import { errorMessage } from "@/portal/lib";

const AUDIENCES: { key: DirectorBroadcastInputAudience; label: string }[] = [
  { key: "all", label: "Teachers and administrators" }, { key: "teachers", label: "Teachers" }, { key: "admins", label: "Administrators" },
];
const label = (a: string) => AUDIENCES.find((x) => x.key === a)?.label ?? a;

/** The Director emails staff: teachers, administrators or both. Each person gets their own copy. */
export function StaffEmail() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useListDirectorBroadcasts({ query: { queryKey: getListDirectorBroadcastsQueryKey() } });
  const send = useSendDirectorBroadcast();
  const [audience, setAudience] = useState<DirectorBroadcastInputAudience>("all");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);

  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <ErrorPanel title="Staff email did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const count = q.data.counts[audience];
  const ready = q.data.emailReady && subject.trim() && !/[\r\n]/.test(subject) && message.trim() && count > 0;
  const go = async () => {
    try {
      const r = await send.mutateAsync({ data: { audience, subject: subject.trim(), message } });
      toast({ title: "Email sent", description: `${r.sent} of ${r.recipients} delivered.` });
      setSubject(""); setMessage(""); setConfirm(false);
      void qc.invalidateQueries({ queryKey: getListDirectorBroadcastsQueryKey() });
    } catch (e) { toast({ variant: "destructive", title: "Not sent", description: errorMessage(e) }); setConfirm(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <section className="portal-card min-w-0 space-y-4 p-5" data-testid="panel-staff-email">
        <div><h2 className="font-serif text-xl font-semibold">Email staff</h2><p className="text-sm text-[hsl(var(--p-ink)/0.65)]">Only teachers and administrators can receive these emails. Each person gets their own copy, so nobody sees the other addresses.</p></div>
        {!q.data.emailReady && <p className="rounded-xl bg-[hsl(var(--p-gold-soft)/0.7)] p-3 text-sm font-semibold">Email is not set up yet. Ask your developer to add the email settings (Resend) in Render.</p>}
        <div role="radiogroup" aria-label="Send to" className="grid gap-2 sm:grid-cols-3">
          {AUDIENCES.map((a) => (
            <button key={a.key} type="button" role="radio" aria-checked={audience === a.key} onClick={() => setAudience(a.key)}
              className={"rounded-xl border p-3 text-left text-sm transition-colors " + (audience === a.key ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald-soft)/0.6)]" : "border-[hsl(var(--p-line))] hover:border-[hsl(var(--p-emerald)/0.5)]")} data-testid={"audience-" + a.key}>
              <span className="block font-semibold">{a.label}</span>
              <span className="text-xs text-[hsl(var(--p-ink)/0.6)]"><Users size={11} className="mr-1 inline" />{q.data.counts[a.key]} {q.data.counts[a.key] === 1 ? "person" : "people"}</span>
            </button>
          ))}
        </div>
        <Field label="Subject" htmlFor="se-subject"><input id="se-subject" className="portal-input" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value.replace(/[\r\n]/g, " "))} placeholder="e.g. Staff meeting on Friday" data-testid="input-staff-subject" /></Field>
        <Field label="Message" htmlFor="se-message" hint="Leave a blank line between paragraphs."><textarea id="se-message" className="portal-input min-h-[200px] leading-relaxed" maxLength={10000} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="input-staff-message" /></Field>
        <button className="portal-btn" disabled={!ready || send.isPending} onClick={() => setConfirm(true)} data-testid="button-staff-send"><Send size={14} /> Send to {count} {count === 1 ? "person" : "people"}</button>
      </section>

      <div className="min-w-0 space-y-5">
        <section className="portal-card overflow-hidden" aria-label="Preview">
          <div className="bg-[#10232c] px-5 py-4 text-[#f7f4ec]"><p className="font-serif text-base font-semibold">New World Emerald Private School</p></div>
          <div className="space-y-3 p-5">
            <h3 className="font-serif text-lg font-semibold" data-testid="text-staff-preview-subject">{subject || "Your subject"}</h3>
            {(message.trim() ? message.trim().split(/\n\s*\n/) : ["Your message appears here as staff will read it."]).map((para, i) => <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">{para}</p>)}
            <p className="text-sm">The Director<br /><span className="text-[hsl(var(--p-ink)/0.6)]">New World Emerald Private School</span></p>
          </div>
        </section>
        <section className="portal-card p-5">
          <h3 className="flex items-center gap-2 font-serif text-lg font-semibold"><Mail size={16} /> Sent</h3>
          {!q.data.history.length ? <p className="mt-2 text-sm text-[hsl(var(--p-ink)/0.6)]">No staff emails yet.</p> : (
            <ul className="mt-2 divide-y divide-[hsl(var(--p-line))]" data-testid="list-staff-email-history">
              {q.data.history.map((h) => (
                <li key={h.id} className="py-2.5 text-sm">
                  <p className="font-semibold">{h.subject}</p>
                  <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{label(h.audience)} · {h.sent} of {h.recipients} delivered{h.failed ? `, ${h.failed} failed` : ""} · {new Date(h.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">Send this email?</DialogTitle>
            <DialogDescription>"{subject}" goes to {count} {label(audience).toLowerCase()}. Sending takes about {Math.max(1, Math.round(count * 0.6))} seconds; please keep this page open.</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2">
            <button className="portal-btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="portal-btn" disabled={send.isPending} onClick={() => void go()} data-testid="button-confirm-staff-send">{send.isPending ? "Sending..." : "Send"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
