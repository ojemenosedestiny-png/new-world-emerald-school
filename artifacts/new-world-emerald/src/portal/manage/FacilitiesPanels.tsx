import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFacilities, getGetFacilitiesQueryKey, useManageFacilities,
  type Facilities, type FacilitiesCommand, type FacilitiesCommandBlock, type FacilitiesCommandRoom, type FacilitiesCommandRoute, type HostelRoom, type TransportRoute,
} from "@workspace/api-client-react";
import { BedDouble, Bus, Pencil, Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ProductPhotoUpload } from "@/components/ProductPhotoUpload";
import { productPhotoUrl } from "@/lib/productPhotoUrl";
import { EmptyState, ErrorPanel, Field, Skeleton } from "../ui";
import { errorMessage } from "../lib";

export const naira = (kobo: number) => "₦" + (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 });
const toKobo = (naira: string) => Math.round((Number(naira.replace(/[^\d.]/g, "")) || 0) * 100);
const GENDER = { boys: "Boys", girls: "Girls", mixed: "Boys and girls" } as const;

function useFacilitiesCommand() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useManageFacilities();
  const run = async (data: FacilitiesCommand) => {
    try {
      const r = await m.mutateAsync({ data });
      toast({ title: r.message });
      await qc.invalidateQueries({ queryKey: getGetFacilitiesQueryKey() });
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); return false; }
  };
  return { run, pending: m.isPending };
}

function Figures({ items }: { items: [string, string, string?][] }) {
  return (
    <section className={"portal-card grid grid-cols-2 divide-[hsl(var(--p-line))] overflow-hidden md:divide-x " + (items.length > 4 ? "md:grid-cols-5" : "md:grid-cols-4")}>
      {items.map(([label, value, tone]) => (
        <div key={label} className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--p-ink)/0.55)]">{label}</p><p className={"mt-1 font-serif text-3xl font-semibold tabular-nums " + (tone ?? "")}>{value}</p></div>
      ))}
    </section>
  );
}

function StudentPicker({ data, value, onChange, id }: { data: Facilities; value: number; onChange: (id: number) => void; id: string }) {
  const [q, setQ] = useState("");
  const matches = data.students.filter((s) => !q.trim() || `${s.name} ${s.studentCode} ${s.className}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 200);
  return (
    <div className="space-y-2">
      <input className="portal-input" placeholder="Search name, student ID or class" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
      <select id={id} className="portal-input" size={6} value={value || ""} onChange={(e) => onChange(Number(e.target.value))} data-testid={id}>
        {matches.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.className} · {s.studentCode}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- Hostel

function BlockDialog({ initial, onClose }: { initial: FacilitiesCommandBlock; onClose: () => void }) {
  const cmd = useFacilitiesCommand();
  const [b, setB] = useState(initial);
  const [uploading, setUploading] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{b.id ? "Edit block" : "Add hostel block"}</DialogTitle><DialogDescription>A building or wing that holds rooms.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Block name" htmlFor="hb-name"><input id="hb-name" className="portal-input" maxLength={80} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} placeholder="e.g. Emerald House" data-testid="input-block-name" /></Field>
          <Field label="For" htmlFor="hb-gender"><select id="hb-gender" className="portal-input" value={b.gender} onChange={(e) => setB({ ...b, gender: e.target.value as FacilitiesCommandBlock["gender"] })}>{Object.entries(GENDER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Description" htmlFor="hb-desc"><textarea id="hb-desc" className="portal-input min-h-[70px]" maxLength={600} value={b.description} onChange={(e) => setB({ ...b, description: e.target.value })} /></Field>
          <div><p className="portal-label mb-1.5">Photo</p><ProductPhotoUpload productKey={"block-" + (b.id ?? "new")} value={b.imageUrl} onChange={(imageUrl) => setB({ ...b, imageUrl })} onUploadingChange={setUploading} /></div>
        </div>
        <DialogFooter><button className="portal-btn" disabled={!b.name.trim() || cmd.pending || uploading} onClick={async () => { if (await cmd.run({ action: "saveBlock", block: b })) onClose(); }} data-testid="button-save-block">Save block</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoomDialog({ initial, onClose }: { initial: FacilitiesCommandRoom; onClose: () => void }) {
  const cmd = useFacilitiesCommand();
  const [r, setR] = useState(initial);
  const [price, setPrice] = useState(initial.priceKobo ? String(initial.priceKobo / 100) : "");
  const [uploading, setUploading] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{r.id ? "Edit room" : "Add room"}</DialogTitle><DialogDescription>Bed spaces decide how many students the room holds.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Room name or number" htmlFor="hr-name"><input id="hr-name" className="portal-input" maxLength={60} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. Room 4" data-testid="input-room-name" /></Field>
          <Field label="Bed spaces" htmlFor="hr-beds"><input id="hr-beds" type="number" min={1} max={100} className="portal-input" value={r.beds} onChange={(e) => setR({ ...r, beds: Math.floor(Number(e.target.value)) })} data-testid="input-room-beds" /></Field>
          <Field label="Price per term (₦)" htmlFor="hr-price"><input id="hr-price" inputMode="decimal" className="portal-input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="150000" data-testid="input-room-price" /></Field>
          <div className="sm:col-span-2"><Field label="Notes" htmlFor="hr-notes"><textarea id="hr-notes" className="portal-input min-h-[60px]" maxLength={600} value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })} placeholder="Bunk beds, en-suite, fan" /></Field></div>
          <div className="sm:col-span-2"><p className="portal-label mb-1.5">Photo</p><ProductPhotoUpload productKey={"room-" + (r.id ?? "new")} value={r.imageUrl} onChange={(imageUrl) => setR({ ...r, imageUrl })} onUploadingChange={setUploading} /></div>
        </div>
        <DialogFooter><button className="portal-btn" disabled={!r.name.trim() || !(r.beds >= 1) || cmd.pending || uploading} onClick={async () => { if (await cmd.run({ action: "saveRoom", room: { ...r, priceKobo: toKobo(price) } })) onClose(); }} data-testid="button-save-room">Save room</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllocateDialog({ data, room, onClose }: { data: Facilities; room: HostelRoom; onClose: () => void }) {
  const cmd = useFacilitiesCommand();
  const [studentId, setStudentId] = useState(0);
  const [bed, setBed] = useState(`Bed ${room.occupants.length + 1}`);
  const current = data.blocks.flatMap((b) => b.rooms.map((r) => ({ b, r }))).find(({ r }) => r.occupants.some((o) => o.studentId === studentId));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Allocate to {room.name}</DialogTitle><DialogDescription>{room.beds - room.occupants.length} of {room.beds} bed spaces free.</DialogDescription></DialogHeader>
        <StudentPicker data={data} value={studentId} onChange={setStudentId} id="select-allocate-student" />
        {current && current.r.id !== room.id && <p className="rounded-lg bg-[hsl(var(--p-gold-soft)/0.7)] px-3 py-2 text-sm">Currently in {current.b.name}, {current.r.name}. Allocating moves them here.</p>}
        <Field label="Bed space" htmlFor="al-bed"><input id="al-bed" className="portal-input" maxLength={40} value={bed} onChange={(e) => setBed(e.target.value)} data-testid="input-allocate-bed" /></Field>
        <DialogFooter><button className="portal-btn" disabled={!studentId || cmd.pending} onClick={async () => { if (await cmd.run({ action: "allocate", allocation: { studentId, roomId: room.id, bed } })) onClose(); }} data-testid="button-confirm-allocate">Allocate</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HostelPanel() {
  const q = useGetFacilities({ query: { queryKey: getGetFacilitiesQueryKey() } });
  const cmd = useFacilitiesCommand();
  const [block, setBlock] = useState<FacilitiesCommandBlock | null>(null);
  const [room, setRoom] = useState<FacilitiesCommandRoom | null>(null);
  const [allocating, setAllocating] = useState<HostelRoom | null>(null);
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <ErrorPanel title="Hostels did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const data = q.data;
  const rooms = data.blocks.flatMap((b) => b.rooms);
  const beds = rooms.reduce((s, r) => s + r.beds, 0);
  const used = rooms.reduce((s, r) => s + r.occupants.length, 0);
  return (
    <div className="space-y-4">
      <Figures items={[["Blocks", String(data.blocks.length)], ["Rooms", String(rooms.length)], ["Bed spaces", String(beds)], ["Occupied", beds ? `${Math.round((used / beds) * 100)}%` : "-"], ["Free beds", String(beds - used), beds - used ? "text-[hsl(var(--p-emerald))]" : "text-[hsl(var(--p-red))]"]]} />
      <div className="flex justify-end"><button className="portal-btn" onClick={() => setBlock({ name: "", gender: "mixed", description: "", imageUrl: "" })} data-testid="button-add-block"><Plus size={15} /> Add block</button></div>
      {!data.blocks.length ? <EmptyState icon={<BedDouble size={22} />} title="No hostel blocks yet" body="Add each boarding house, then its rooms and bed spaces. You can then allocate students." /> : data.blocks.map((b) => {
        const bBeds = b.rooms.reduce((s, r) => s + r.beds, 0), bUsed = b.rooms.reduce((s, r) => s + r.occupants.length, 0);
        return (
          <section key={b.id} className="portal-card overflow-hidden" data-testid={"block-" + b.id}>
            <div className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--p-line))] p-4">
              {b.imageUrl ? <img src={productPhotoUrl(b.imageUrl)} alt="" className="h-14 w-20 rounded-lg object-cover" /> : <span className="grid h-14 w-20 place-items-center rounded-lg bg-[hsl(var(--p-paper-2))]"><BedDouble size={20} aria-hidden="true" /></span>}
              <div className="min-w-0 flex-1"><h3 className="font-serif text-xl font-semibold">{b.name}</h3><p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{GENDER[b.gender]} · {b.rooms.length} {b.rooms.length === 1 ? "room" : "rooms"} · {bUsed} of {bBeds} beds taken</p></div>
              <div className="flex gap-1.5">
                <button className="portal-btn-ghost" onClick={() => setRoom({ blockId: b.id, name: "", beds: 4, priceKobo: 0, imageUrl: "", notes: "" })} data-testid={"button-add-room-" + b.id}><Plus size={13} /> Room</button>
                <button className="portal-btn-ghost !px-2" aria-label={"Edit " + b.name} onClick={() => setBlock({ id: b.id, name: b.name, gender: b.gender, description: b.description, imageUrl: b.imageUrl })}><Pencil size={13} /></button>
                <button className="portal-btn-ghost !px-2 text-[hsl(var(--p-red))]" aria-label={"Remove " + b.name} onClick={() => { if (window.confirm(`Remove ${b.name} and its rooms?`)) void cmd.run({ action: "deleteBlock", id: b.id }); }}><Trash2 size={13} /></button>
              </div>
            </div>
            {!b.rooms.length ? <p className="p-4 text-sm text-[hsl(var(--p-ink)/0.6)]">No rooms yet.</p> : (
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {b.rooms.map((r) => (
                  <article key={r.id} className="rounded-xl border border-[hsl(var(--p-line))] p-3" data-testid={"room-" + r.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div><p className="font-semibold">{r.name}</p><p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{r.priceKobo ? naira(r.priceKobo) + " per term" : "No price set"}{r.notes ? ` · ${r.notes}` : ""}</p></div>
                      <span className={"rounded-full px-2.5 py-0.5 text-xs font-bold " + (r.status === "full" ? "bg-[hsl(var(--p-red)/0.1)] text-[hsl(var(--p-red))]" : "bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]")} data-testid={"room-status-" + r.id}>{r.status === "full" ? "Full" : `${r.beds - r.occupants.length} free`}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))]"><div className="h-full rounded-full bg-[hsl(var(--p-emerald))]" style={{ width: `${(r.occupants.length / r.beds) * 100}%` }} /></div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {r.occupants.map((o) => (
                        <li key={o.studentId} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{o.name} <span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{o.className}{o.detail ? ` · ${o.detail}` : ""}</span></span>
                          <button className="portal-btn-ghost !p-1.5 text-[hsl(var(--p-red))]" aria-label={`Move ${o.name} out`} onClick={() => void cmd.run({ action: "unallocate", id: o.studentId })}><UserMinus size={13} /></button></li>
                      ))}
                    </ul>
                    <div className="mt-2 flex gap-1.5">
                      <button className="portal-btn-ghost flex-1 justify-center !py-1.5 text-xs" disabled={r.status === "full"} onClick={() => setAllocating(r)} data-testid={"button-allocate-" + r.id}><UserPlus size={13} /> Allocate</button>
                      <button className="portal-btn-ghost !px-2 !py-1.5" aria-label={"Edit " + r.name} onClick={() => setRoom({ id: r.id, blockId: b.id, name: r.name, beds: r.beds, priceKobo: r.priceKobo, imageUrl: r.imageUrl, notes: r.notes })}><Pencil size={12} /></button>
                      <button className="portal-btn-ghost !px-2 !py-1.5 text-[hsl(var(--p-red))]" aria-label={"Remove " + r.name} onClick={() => { if (window.confirm(`Remove ${r.name}?`)) void cmd.run({ action: "deleteRoom", id: r.id }); }}><Trash2 size={12} /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {block && <BlockDialog initial={block} onClose={() => setBlock(null)} />}
      {room && <RoomDialog initial={room} onClose={() => setRoom(null)} />}
      {allocating && <AllocateDialog data={data} room={allocating} onClose={() => setAllocating(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Transport

function RouteDialog({ initial, onClose }: { initial: FacilitiesCommandRoute; onClose: () => void }) {
  const cmd = useFacilitiesCommand();
  const [r, setR] = useState(initial);
  const [fee, setFee] = useState(initial.feeKobo ? String(initial.feeKobo / 100) : "");
  const setStop = (i: number, patch: Partial<FacilitiesCommandRoute["stops"][number]>) => setR({ ...r, stops: r.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{r.id ? "Edit route" : "Add route"}</DialogTitle><DialogDescription>List the stops in the order the bus reaches them in the morning.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Route name" htmlFor="rt-name"><input id="rt-name" className="portal-input" maxLength={80} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. Ikeja - Ojota" data-testid="input-route-name" /></Field>
          <Field label="Fee per term (₦)" htmlFor="rt-fee"><input id="rt-fee" inputMode="decimal" className="portal-input" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="40000" /></Field>
          <Field label="Driver's name" htmlFor="rt-driver"><input id="rt-driver" className="portal-input" maxLength={80} value={r.driverName} onChange={(e) => setR({ ...r, driverName: e.target.value })} /></Field>
          <Field label="Driver's phone" htmlFor="rt-phone"><input id="rt-phone" type="tel" className="portal-input" maxLength={20} value={r.driverPhone} onChange={(e) => setR({ ...r, driverPhone: e.target.value })} placeholder="0803 123 4567" /></Field>
          <Field label="Vehicle" htmlFor="rt-vehicle"><input id="rt-vehicle" className="portal-input" maxLength={80} value={r.vehicle} onChange={(e) => setR({ ...r, vehicle: e.target.value })} placeholder="Toyota Coaster, white" /></Field>
          <Field label="Plate number" htmlFor="rt-plate"><input id="rt-plate" className="portal-input uppercase" maxLength={20} value={r.plate} onChange={(e) => setR({ ...r, plate: e.target.value })} /></Field>
        </div>
        <div>
          <p className="portal-label mb-1.5">Stops and times</p>
          <div className="space-y-2">
            {r.stops.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] items-center gap-2" data-testid={"stop-row-" + i}>
                <input className="portal-input !py-1.5" maxLength={80} placeholder={`Stop ${i + 1}`} value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} aria-label={`Stop ${i + 1} name`} />
                <input type="time" className="portal-input !py-1.5" value={s.pickup} onChange={(e) => setStop(i, { pickup: e.target.value })} aria-label={`Pick-up time at stop ${i + 1}`} />
                <input type="time" className="portal-input !py-1.5" value={s.dropoff} onChange={(e) => setStop(i, { dropoff: e.target.value })} aria-label={`Drop-off time at stop ${i + 1}`} />
                <button className="portal-btn-ghost !px-2 text-[hsl(var(--p-red))]" disabled={r.stops.length <= 1} onClick={() => setR({ ...r, stops: r.stops.filter((_, j) => j !== i) })} aria-label={`Remove stop ${i + 1}`}><Trash2 size={13} /></button>
              </div>
            ))}
            <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">Columns: stop, morning pick-up, afternoon drop-off.</p>
            <button className="portal-btn-ghost" disabled={r.stops.length >= 40} onClick={() => setR({ ...r, stops: [...r.stops, { name: "", pickup: "", dropoff: "" }] })} data-testid="button-add-stop"><Plus size={13} /> Add stop</button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} /> Route is running</label>
        <DialogFooter><button className="portal-btn" disabled={!r.name.trim() || r.stops.some((s) => !s.name.trim()) || cmd.pending} onClick={async () => { if (await cmd.run({ action: "saveRoute", route: { ...r, feeKobo: toKobo(fee) } })) onClose(); }} data-testid="button-save-route">Save route</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ data, route, onClose }: { data: Facilities; route: TransportRoute; onClose: () => void }) {
  const cmd = useFacilitiesCommand();
  const [studentId, setStudentId] = useState(0);
  const [stop, setStop] = useState(route.stops[0]?.name ?? "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Assign to {route.name}</DialogTitle><DialogDescription>Choose the student and the stop they use.</DialogDescription></DialogHeader>
        <StudentPicker data={data} value={studentId} onChange={setStudentId} id="select-assign-student" />
        <Field label="Stop" htmlFor="as-stop"><select id="as-stop" className="portal-input" value={stop} onChange={(e) => setStop(e.target.value)} data-testid="select-assign-stop">{route.stops.map((s) => <option key={s.name} value={s.name}>{s.name}{s.pickup ? ` (pick-up ${s.pickup})` : ""}</option>)}</select></Field>
        <DialogFooter><button className="portal-btn" disabled={!studentId || !stop || cmd.pending} onClick={async () => { if (await cmd.run({ action: "assignRoute", assignment: { studentId, routeId: route.id, stop } })) onClose(); }} data-testid="button-confirm-assign">Assign</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TransportPanel() {
  const q = useGetFacilities({ query: { queryKey: getGetFacilitiesQueryKey() } });
  const cmd = useFacilitiesCommand();
  const [route, setRoute] = useState<FacilitiesCommandRoute | null>(null);
  const [assigning, setAssigning] = useState<TransportRoute | null>(null);
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <ErrorPanel title="Transport did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const data = q.data;
  const riders = data.routes.reduce((s, r) => s + r.riders.length, 0);
  return (
    <div className="space-y-4">
      <Figures items={[["Routes", String(data.routes.length)], ["Running", String(data.routes.filter((r) => r.active).length)], ["Students riding", String(riders)], ["Stops", String(data.routes.reduce((s, r) => s + r.stops.length, 0))]]} />
      <div className="flex justify-end"><button className="portal-btn" onClick={() => setRoute({ name: "", stops: [{ name: "", pickup: "", dropoff: "" }], driverName: "", driverPhone: "", vehicle: "", plate: "", feeKobo: 0, notes: "", active: true })} data-testid="button-add-route"><Plus size={15} /> Add route</button></div>
      {!data.routes.length ? <EmptyState icon={<Bus size={22} />} title="No routes yet" body="Add each bus route with its stops and times, then assign students to their stop." /> : data.routes.map((r) => (
        <section key={r.id} className="portal-card overflow-hidden" data-testid={"route-" + r.id}>
          <div className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--p-line))] p-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-[hsl(var(--p-paper-2))]"><Bus size={20} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <h3 className="flex items-center gap-2 font-serif text-xl font-semibold">{r.name}{!r.active && <span className="rounded-full bg-[hsl(var(--p-paper-2))] px-2 py-0.5 font-sans text-xs font-bold">Not running</span>}</h3>
              <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{[r.driverName && `Driver ${r.driverName}`, r.driverPhone, [r.vehicle, r.plate].filter(Boolean).join(" · "), r.feeKobo ? naira(r.feeKobo) + " per term" : ""].filter(Boolean).join(" · ") || "No driver or vehicle details yet"}</p>
            </div>
            <div className="flex gap-1.5">
              <button className="portal-btn-ghost" disabled={!r.active} onClick={() => setAssigning(r)} data-testid={"button-assign-" + r.id}><UserPlus size={13} /> Assign student</button>
              <button className="portal-btn-ghost !px-2" aria-label={"Edit " + r.name} onClick={() => setRoute({ id: r.id, name: r.name, stops: r.stops, driverName: r.driverName, driverPhone: r.driverPhone, vehicle: r.vehicle, plate: r.plate, feeKobo: r.feeKobo, notes: r.notes, active: r.active })}><Pencil size={13} /></button>
              <button className="portal-btn-ghost !px-2 text-[hsl(var(--p-red))]" aria-label={"Remove " + r.name} onClick={() => { if (window.confirm(`Remove ${r.name}?`)) void cmd.run({ action: "deleteRoute", id: r.id }); }}><Trash2 size={13} /></button>
            </div>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <ol className="space-y-0" aria-label="Stops">
              {r.stops.map((s, i) => (
                <li key={s.name} className="grid grid-cols-[1.25rem_1fr_auto] gap-3">
                  <span className="relative flex justify-center"><span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[hsl(var(--p-emerald))]" />{i < r.stops.length - 1 && <span className="absolute top-4 h-full w-px bg-[hsl(var(--p-line))]" />}</span>
                  <span className="pb-3"><span className="block text-sm font-semibold">{s.name}</span><span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{((n) => `${n} ${n === 1 ? "student" : "students"}`)(r.riders.filter((x) => x.detail === s.name).length)}</span></span>
                  <span className="pb-3 text-right text-xs tabular-nums text-[hsl(var(--p-ink)/0.7)]">{s.pickup && <span className="block">Pick-up {s.pickup}</span>}{s.dropoff && <span className="block">Drop-off {s.dropoff}</span>}</span>
                </li>
              ))}
            </ol>
            <div>
              <p className="portal-label mb-1.5">Students ({r.riders.length})</p>
              {!r.riders.length ? <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">Nobody assigned yet.</p> : (
                <ul className="max-h-64 divide-y divide-[hsl(var(--p-line))] overflow-y-auto text-sm">
                  {r.riders.map((o) => (
                    <li key={o.studentId} className="flex items-center gap-2 py-1.5"><span className="min-w-0 flex-1 truncate">{o.name} <span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{o.className} · {o.detail}</span></span>
                      <button className="portal-btn-ghost !p-1.5 text-[hsl(var(--p-red))]" aria-label={`Remove ${o.name} from the route`} onClick={() => void cmd.run({ action: "unassignRoute", id: o.studentId })}><UserMinus size={13} /></button></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ))}
      {route && <RouteDialog initial={route} onClose={() => setRoute(null)} />}
      {assigning && <AssignDialog data={data} route={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}
