import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTapInQueryKey, useGetTapIn, useManageTapIn, type PortalManagement, type TapInCommand, type TapInOverview,
} from "@workspace/api-client-react";
import { Copy, CreditCard, KeyRound, MonitorSmartphone, Plus, Power, RefreshCw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const RESULT: Record<string, { label: string; tone: "green" | "gold" | "ink" | "red" | "muted" }> = {
  present: { label: "Present", tone: "green" }, late: { label: "Late", tone: "gold" }, already: { label: "Already in", tone: "ink" },
  unknown_card: { label: "New card", tone: "red" }, inactive: { label: "Inactive", tone: "muted" }, refused: { label: "Refused", tone: "muted" },
};
const clock = (iso: string) => new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function useRun() {
  const m = useManageTapIn();
  const qc = useQueryClient();
  const { toast } = useToast();
  const run = async (data: TapInCommand) => {
    try {
      const r = await m.mutateAsync({ data });
      toast({ title: r.message });
      await qc.invalidateQueries({ queryKey: getGetTapInQueryKey() });
      return r;
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); return null; }
  };
  return { run, pending: m.isPending };
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const { toast } = useToast();
  return (
    <button type="button" className="portal-btn-ghost !min-h-[32px] !px-3 text-xs" onClick={() => { void navigator.clipboard?.writeText(text).then(() => toast({ title: "Copied" }), () => undefined); }}>
      <Copy size={13} /> {label}
    </button>
  );
}

/** Pick an active student: type part of a name, class or student ID, then choose. */
function StudentPicker({ students, classes, value, onChange, testId }: { students: PortalManagement["students"]; classes: PortalManagement["classes"]; value: number; onChange: (id: number) => void; testId: string }) {
  const [q, setQ] = useState("");
  const className = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const needle = q.trim().toLowerCase();
  const matches = students.filter((s) => s.active && (!needle || s.name.toLowerCase().includes(needle) || s.studentId.toLowerCase().includes(needle) || (className.get(s.classId) ?? "").toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row">
      <input className="portal-input sm:!w-44" placeholder="Search student" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search student" data-testid={`${testId}-search`} />
      <select className="portal-input min-w-0 flex-1" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Student" data-testid={testId}>
        <option value={0}>{matches.length ? "Choose the student" : "No student matches"}</option>
        {matches.map((s) => <option key={s.id} value={s.id}>{s.name} · {className.get(s.classId) ?? ""} · {s.studentId}</option>)}
      </select>
    </div>
  );
}

/** Shown once after a kiosk is added or given a new key: the key and how to connect the Tapping software. */
function KeyDialog({ shown, address, onClose }: { shown: { name: string; key: string } | null; address: string; onClose: () => void }) {
  const example = `POST ${address}\nAuthorization: Bearer ${shown?.key ?? ""}\nContent-Type: application/json\n\n{"cardId": "04A1B2C3", "tapId": "123"}`;
  return (
    <Dialog open={!!shown} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Key for {shown?.name}</DialogTitle>
          <DialogDescription>Put this key into the Tapping software on that kiosk. It is shown only this once; if it is lost, make a new key.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold">Kiosk key</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-[hsl(var(--p-ink)/0.06)] px-3 py-2 font-mono text-xs" data-testid="text-kiosk-key">{shown?.key}</code>
              <CopyButton text={shown?.key ?? ""} />
            </div>
          </div>
          <div>
            <p className="font-semibold">Address to send taps to</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-[hsl(var(--p-ink)/0.06)] px-3 py-2 font-mono text-xs">{address}</code>
              <CopyButton text={address} />
            </div>
          </div>
          <div>
            <p className="font-semibold">Each tap, as the Tapping software sends it</p>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[hsl(var(--p-ink)/0.06)] px-3 py-2 font-mono text-xs">{example}</pre>
            <p className={"mt-1 text-xs " + MUTED}>The answer has a <span className="font-mono">message</span> to show on the kiosk screen, such as "Welcome, Ada. Marked present at 07:42."</p>
          </div>
        </div>
        <DialogFooter><button type="button" className="portal-btn" onClick={onClose} data-testid="button-close-kiosk-key">I have copied the key</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kiosks({ data, run, pending, onKey }: { data: TapInOverview; run: ReturnType<typeof useRun>["run"]; pending: boolean; onKey: (k: { name: string; key: string }) => void }) {
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<TapInOverview["kiosks"][number] | null>(null);
  const add = async () => {
    const r = await run({ action: "addKiosk", name: name.trim() });
    if (r?.key) { onKey({ name: name.trim(), key: r.key }); setName(""); }
  };
  return (
    <section className="portal-card p-5" data-testid="tap-kiosks">
      <h3 className="flex items-center gap-2 font-serif text-xl font-semibold"><MonitorSmartphone size={18} /> Kiosks</h3>
      <p className={"mt-1 text-sm " + MUTED}>Each kiosk device gets its own key. Turn one off, or give it a new key, if a device is lost.</p>
      <div className="mt-4 divide-y divide-[hsl(var(--p-line))]">
        {data.kiosks.map((k) => (
          <div key={k.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`kiosk-${k.id}`}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{k.name} {!k.active && <StatusPill tone="muted">Off</StatusPill>}</p>
              <p className={"text-xs " + MUTED}>Key ending <span className="font-mono">…{k.keyHint}</span> · {k.lastSeenAt ? `last heard from ${clock(k.lastSeenAt)}` : "not connected yet"}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" disabled={pending} onClick={() => void run({ action: "setKioskActive", kioskId: k.id, active: !k.active })} data-testid={`button-kiosk-power-${k.id}`}><Power size={13} /> {k.active ? "Turn off" : "Turn on"}</button>
              <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" disabled={pending} onClick={async () => { const r = await run({ action: "newKioskKey", kioskId: k.id }); if (r?.key) onKey({ name: k.name, key: r.key }); }} data-testid={`button-kiosk-key-${k.id}`}><KeyRound size={13} /> New key</button>
              <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" disabled={pending} onClick={() => setRemoving(k)} data-testid={`button-kiosk-remove-${k.id}`}><Trash2 size={13} /> Remove</button>
            </div>
          </div>
        ))}
        {!data.kiosks.length && <p className={"py-3 text-sm " + MUTED}>No kiosks yet. Add one for each tap-in device.</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className="portal-input min-w-0 flex-1" maxLength={60} placeholder="Kiosk name, like Main gate" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-kiosk-name" />
        <button type="button" className="portal-btn" disabled={pending || name.trim().length < 2} onClick={() => void add()} data-testid="button-add-kiosk"><Plus size={15} /> Add kiosk</button>
      </div>
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">Remove {removing?.name}?</DialogTitle>
            <DialogDescription>Its key stops working at once. Attendance it already marked stays in the register.</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2">
            <button type="button" className="portal-btn-ghost" onClick={() => setRemoving(null)}>Cancel</button>
            <button type="button" className="portal-btn" disabled={pending} onClick={async () => { if (removing && await run({ action: "deleteKiosk", kioskId: removing.id })) setRemoving(null); }} data-testid="button-confirm-remove-kiosk">Remove</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Cards({ data, mgmt, run, pending }: { data: TapInOverview; mgmt: PortalManagement; run: ReturnType<typeof useRun>["run"]; pending: boolean }) {
  const [cardId, setCardId] = useState("");
  const [studentId, setStudentId] = useState(0);
  const [newFor, setNewFor] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const cards = data.cards.filter((c) => !needle || c.studentName.toLowerCase().includes(needle) || c.cardId.toLowerCase().includes(needle) || c.className.toLowerCase().includes(needle) || c.studentNumber.toLowerCase().includes(needle));
  const link = async () => { if (await run({ action: "assignCard", cardId: cardId.trim(), studentId })) { setCardId(""); setStudentId(0); } };
  return (
    <section className="portal-card p-5" data-testid="tap-cards">
      <h3 className="flex items-center gap-2 font-serif text-xl font-semibold"><CreditCard size={18} /> Students' cards</h3>
      <p className={"mt-1 text-sm " + MUTED}>The easiest way: tap a new card on a kiosk, then link it to the student below under New cards.</p>

      {data.unknownCards.length > 0 && (
        <div className="mt-4 rounded-xl border border-[hsl(var(--p-gold)/0.5)] bg-[hsl(var(--p-gold-soft))] p-4" data-testid="tap-unknown-cards">
          <p className="font-semibold">New cards tapped on a kiosk ({data.unknownCards.length})</p>
          <div className="mt-2 space-y-2">
            {data.unknownCards.map((u) => (
              <div key={u.cardId} className="flex flex-wrap items-center gap-2" data-testid={`unknown-card-${u.cardId}`}>
                <div className="w-full sm:w-44">
                  <p className="font-mono text-sm font-semibold">{u.cardId}</p>
                  <p className={"text-xs " + MUTED}>{clock(u.lastAt)} · {u.kioskName}</p>
                </div>
                <StudentPicker students={mgmt.students} classes={mgmt.classes} value={newFor[u.cardId] ?? 0} onChange={(id) => setNewFor({ ...newFor, [u.cardId]: id })} testId={`select-unknown-student-${u.cardId}`} />
                <button type="button" className="portal-btn !min-h-[38px]" disabled={pending || !newFor[u.cardId]} onClick={() => void run({ action: "assignCard", cardId: u.cardId, studentId: newFor[u.cardId] })} data-testid={`button-link-unknown-${u.cardId}`}>Link</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        <p className="text-sm font-semibold">Link a card by its number</p>
        <div className="flex flex-col gap-2 lg:flex-row">
          <input className="portal-input font-mono lg:!w-48" maxLength={80} placeholder="Card number" value={cardId} onChange={(e) => setCardId(e.target.value)} aria-label="Card number" data-testid="input-card-id" />
          <StudentPicker students={mgmt.students} classes={mgmt.classes} value={studentId} onChange={setStudentId} testId="select-card-student" />
          <button type="button" className="portal-btn" disabled={pending || !cardId.trim() || !studentId} onClick={() => void link()} data-testid="button-link-card">Link card</button>
        </div>
        <p className={"text-xs " + MUTED}>With a USB card reader on this computer, click the card number box and tap the card: the number types itself.</p>
      </div>

      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{data.cards.length} linked {data.cards.length === 1 ? "card" : "cards"}</p>
          {data.cards.length > 8 && <input className="portal-input !w-56" placeholder="Search cards" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cards" />}
        </div>
        <div className="mt-2 max-h-96 divide-y divide-[hsl(var(--p-line))] overflow-y-auto">
          {cards.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2" data-testid={`tap-card-${c.id}`}>
              <span className="w-32 shrink-0 truncate font-mono text-xs">{c.cardId}</span>
              <span className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold">{c.studentName}</span> <span className={MUTED}>· {c.className}</span></span>
              <button type="button" className="portal-btn-ghost !min-h-[30px] !px-2 text-xs" disabled={pending} onClick={() => void run({ action: "removeCard", cardRowId: c.id })} aria-label={`Remove card ${c.cardId}`} data-testid={`button-remove-card-${c.id}`}><Trash2 size={13} /></button>
            </div>
          ))}
          {!cards.length && <p className={"py-3 text-sm " + MUTED}>{data.cards.length ? "No card matches." : "No cards linked yet."}</p>}
        </div>
      </div>
    </section>
  );
}

/** Card tap-in: kiosks mark the register by themselves when children tap their cards at the gate. */
export function TapInPanel({ data: mgmt }: { data: PortalManagement }) {
  const q = useGetTapIn();
  const { run, pending } = useRun();
  const [key, setKey] = useState<{ name: string; key: string } | null>(null);
  const [late, setLate] = useState<string | null>(null);
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (q.isError || !q.data) return <ErrorPanel title="Card tap-in did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const lateValue = late ?? d.lateAfter;
  return (
    <div className="space-y-5" data-testid="tap-in-panel">
      <section className="grid gap-3 sm:grid-cols-4">
        {[["Tapped in today", d.today.tapped], ["On time", d.today.present], ["Late", d.today.late]].map(([label, n]) => (
          <div key={label} className="portal-card p-4"><p className={"text-xs font-semibold uppercase tracking-wide " + MUTED}>{label}</p><p className="mt-1 font-serif text-3xl font-semibold" data-testid={`stat-tap-${String(label).toLowerCase().replace(/\s+/g, "-")}`}>{n}</p></div>
        ))}
        <div className="portal-card p-4">
          <label className={"text-xs font-semibold uppercase tracking-wide " + MUTED} htmlFor="tap-late-after">Late after</label>
          <div className="mt-1 flex gap-2">
            <input id="tap-late-after" type="time" className="portal-input min-w-0" value={lateValue} onChange={(e) => setLate(e.target.value)} data-testid="input-late-after" />
            <button type="button" className="portal-btn-ghost !px-3 text-xs" disabled={pending || lateValue === d.lateAfter} onClick={async () => { if (await run({ action: "setLateAfter", lateAfter: lateValue })) setLate(null); }} data-testid="button-save-late-after">Save</button>
          </div>
        </div>
      </section>
      <p className={"text-sm " + MUTED}>A child's first tap of the day marks them present, or late after {d.lateAfter}, in their class register. A teacher's mark is kept, except "absent", which becomes present or late when the child taps in.</p>

      <div className="grid gap-5 xl:grid-cols-2">
        <Kiosks data={d} run={run} pending={pending} onKey={setKey} />
        <Cards data={d} mgmt={mgmt} run={run} pending={pending} />
      </div>

      <section className="portal-card p-5" data-testid="tap-recent">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-serif text-xl font-semibold">Recent taps</h3>
          <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" onClick={() => void q.refetch()} data-testid="button-refresh-taps"><RefreshCw size={13} /> Refresh</button>
        </div>
        {d.recent.length ? (
          <div className="mt-3 divide-y divide-[hsl(var(--p-line))]">
            {d.recent.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm" data-testid={`tap-event-${e.id}`}>
                <span className={"w-24 shrink-0 tabular-nums " + MUTED}>{clock(e.at)}</span>
                <StatusPill tone={RESULT[e.result]?.tone ?? "muted"}>{RESULT[e.result]?.label ?? e.result}</StatusPill>
                <span className="min-w-0 flex-1 truncate">{e.studentName ? <><span className="font-semibold">{e.studentName}</span> <span className={MUTED}>· {e.className}</span></> : <span className="font-mono text-xs">{e.cardId}</span>}</span>
                <span className={"text-xs " + MUTED}>{e.kioskName}</span>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={<CreditCard size={22} />} title="No taps yet" body="Taps from the kiosks appear here as children arrive." />}
      </section>
      <KeyDialog shown={key} address={d.tapAddress} onClose={() => setKey(null)} />
    </div>
  );
}
