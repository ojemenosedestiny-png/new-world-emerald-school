import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEnrolStudent, useCreateAccountLink, getGetPortalManagementQueryKey, type AccountLinkResult, type PortalManagement } from "@workspace/api-client-react";
import { Copy, MessageCircle, Printer, Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Field } from "../ui";
import { errorMessage, formatDateTime } from "../lib";
import { ClassSelect } from "./ClassSelect";

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type ActivationSlip = { name: string; studentId: string; className: string; url: string; expiresAt: string };

/** Printable activation slips: the family opens the link to choose a password. */
export function activationSlipsHtml(slips: ActivationSlip[]) {
  const body = slips.map((s) => `<section class="slip"><p class="school">New World Emerald Private School</p><h2>${esc(s.name)}</h2><p class="class">${esc(s.className)}</p>
    <dl><dt>Student ID</dt><dd class="mono">${esc(s.studentId)}</dd><dt>Activate at</dt><dd class="link">${esc(s.url)}</dd><dt>Link expires</dt><dd>${esc(new Date(s.expiresAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }))}</dd></dl>
    <p class="note">Open the link with a parent, check the details and choose a private password. Then sign in with the Student ID and that password.</p></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Activation slips</title><style>
    body{font-family:system-ui,"Segoe UI",sans-serif;margin:16px;color:#10232c}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
    .slip{border:1.5px dashed #9aa8ad;border-radius:12px;padding:14px 16px;break-inside:avoid}.school{margin:0;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#1d6b4f;font-weight:700}
    h2{margin:6px 0 0;font-size:18px}.class{margin:2px 0 8px;font-size:12px;color:#4b5d63}dl{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:0;font-size:12.5px}
    dt{color:#4b5d63}dd{margin:0;font-weight:600}.mono{font-family:ui-monospace,Consolas,monospace;font-size:14px}.link{word-break:break-all;font-size:11px;font-family:ui-monospace,Consolas,monospace}
    .note{margin:8px 0 0;font-size:11px;color:#4b5d63}</style></head><body><div class="grid">${body}</div></body></html>`;
}

export function printActivationSlips(slips: ActivationSlip[]) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return false;
  w.document.open(); w.document.write(activationSlipsHtml(slips)); w.document.close();
  const print = () => { try { w.focus(); w.print(); } catch { /* closed */ } };
  if (w.document.readyState === "complete") window.setTimeout(print, 300); else w.addEventListener("load", () => window.setTimeout(print, 100), { once: true });
  return true;
}

export const whatsAppLink = (r: Pick<AccountLinkResult, "student" | "url">, purpose: "activate" | "reset") =>
  "https://wa.me/?text=" + encodeURIComponent(`${purpose === "activate" ? "Activate" : "Reset the password for"} ${r.student.name}'s New World Emerald student portal account (Student ID ${r.student.studentId}): ${r.url}`);

/** Shows a freshly issued link with copy, WhatsApp and print options. */
export function AccountLinkDialog({ result, purpose, onClose }: { result: AccountLinkResult; purpose: "activate" | "reset"; onClose: () => void }) {
  const { toast } = useToast();
  const copy = () => navigator.clipboard.writeText(result.url).then(() => toast({ title: "Link copied" }), () => toast({ variant: "destructive", title: "Copy failed", description: "Select the link and copy it manually." }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{purpose === "activate" ? "Activation link ready" : "Password reset link ready"}</DialogTitle>
          <DialogDescription>{result.student.name} / {result.student.className}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-2xl bg-[hsl(var(--p-ink))] p-4 text-[hsl(var(--p-paper))]">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">Student ID</p>
            <p className="font-mono text-2xl font-bold tracking-wide text-[hsl(var(--p-gold))]" data-testid="text-new-student-id">{result.student.studentId}</p>
          </div>
          <p className={"rounded-xl p-3 text-sm " + (result.emailed ? "bg-[hsl(var(--p-emerald-soft)/0.7)]" : "bg-[hsl(var(--p-gold-soft))]")} data-testid="text-email-note">{result.emailNote}</p>
          <div>
            <p className="portal-label mb-1">Link (works once, expires {formatDateTime(result.expiresAt)})</p>
            <input readOnly className="portal-input font-mono text-xs" value={result.url} onFocus={(e) => e.currentTarget.select()} aria-label="Account link" data-testid="input-account-link" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="portal-btn-ghost" onClick={copy} data-testid="button-copy-link"><Copy size={13} /> Copy link</button>
            <a className="portal-btn-ghost" href={whatsAppLink(result, purpose)} target="_blank" rel="noreferrer" data-testid="link-whatsapp"><MessageCircle size={13} /> Send by WhatsApp</a>
            <button className="portal-btn-ghost" onClick={() => { if (!printActivationSlips([{ name: result.student.name, studentId: result.student.studentId, className: result.student.className, url: result.url, expiresAt: result.expiresAt }])) toast({ variant: "destructive", title: "Pop-up blocked", description: "Allow pop-ups to print." }); }} data-testid="button-print-activation"><Printer size={13} /> Print slip</button>
          </div>
        </div>
        <DialogFooter><button className="portal-btn" onClick={onClose} data-testid="button-close-link">Done</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Issues a fresh activation or reset link for an existing student. */
export function useAccountLink() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const m = useCreateAccountLink();
  const run = async (id: number, purpose: "activate" | "reset") => {
    try {
      const result = await m.mutateAsync({ id, data: { purpose, send: true } });
      await queryClient.invalidateQueries({ queryKey: getGetPortalManagementQueryKey() });
      return result;
    } catch (e) { toast({ variant: "destructive", title: "Link not created", description: errorMessage(e) }); return null; }
  };
  return { run, pending: m.isPending };
}

export function EnrolStudentDialog({ data, onClose, onDone }: { data: PortalManagement; onClose: () => void; onDone: (r: AccountLinkResult) => void }) {
  const queryClient = useQueryClient();
  const m = useEnrolStudent();
  const [form, setForm] = useState({ name: "", classId: data.classes[0]?.id ?? 0, guardianEmail: "", studentId: "", send: true });
  const [legacy, setLegacy] = useState(false);
  const save = () => m.mutate({ data: { name: form.name.trim(), classId: form.classId, guardianEmail: form.guardianEmail.trim() || null, studentId: legacy ? form.studentId.trim() || null : null, send: form.send } }, {
    onSuccess: async (r) => { await queryClient.invalidateQueries({ queryKey: getGetPortalManagementQueryKey() }); onDone(r); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Enrol student</DialogTitle><DialogDescription>A Student ID is created automatically. The family activates the account with a one-time link and chooses their own password.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Full name" htmlFor="en-name"><input id="en-name" className="portal-input" maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-enrol-name" /></Field>
          <Field label="Class" htmlFor="en-class"><ClassSelect id="en-class" classes={data.classes} value={form.classId} onChange={(v) => setForm({ ...form, classId: v })} /></Field>
          <Field label="Student or parent email" htmlFor="en-email" hint="Optional. The Student ID and a link to create a password are emailed here, then a confirmation once the account is ready. You can also share the link by WhatsApp or print it."><input id="en-email" type="email" className="portal-input" maxLength={200} value={form.guardianEmail} onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })} data-testid="input-enrol-email" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.send} onChange={(e) => setForm({ ...form, send: e.target.checked })} /> Email the activation link now</label>
          <div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} data-testid="checkbox-existing-id" /> This student already has an ID</label>
            {legacy && <input className="portal-input mt-2 font-mono" maxLength={50} placeholder="Existing Student ID" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} aria-label="Existing Student ID" data-testid="input-enrol-studentid" />}
          </div>
          {m.isError && <p className="text-sm text-[hsl(var(--p-red))]" role="alert">{errorMessage(m.error)}</p>}
        </div>
        <DialogFooter><button className="portal-btn" disabled={m.isPending || !form.name.trim() || !form.classId || (legacy && !form.studentId.trim())} onClick={save} data-testid="button-enrol-student"><Send size={14} /> {m.isPending ? "Enrolling..." : "Enrol and create link"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
