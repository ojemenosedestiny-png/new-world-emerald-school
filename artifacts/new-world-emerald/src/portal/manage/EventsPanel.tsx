import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPortalEvents, getListPortalEventsQueryKey, useCreatePortalEvent, useUpdatePortalEvent, useDeletePortalEvent,
  type PortalEvent, type PortalEventInput, type PortalManagement,
} from "@workspace/api-client-react";
import { CalendarDays, Clock, MapPin, Pencil, Plus, Trash2, Users } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Field, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { CATEGORIES, calendarItems, whenText } from "../events";

type Form = PortalEventInput & { id?: number };

/** ISO time to the value a datetime-local or date input expects, in the browser's time zone. */
export function toLocalInput(iso: string | null | undefined, allDay: boolean) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? date : `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Input value back to ISO; all-day dates are taken as local midnight. */
export function fromLocalInput(value: string, allDay: boolean) {
  if (!value) return null;
  const d = new Date(allDay ? value.slice(0, 10) + "T00:00" : value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** School calendar for administrators: events for the whole school or one class. */
export function EventsPanel({ data }: { data: PortalManagement }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const list = useListPortalEvents({ query: { queryKey: getListPortalEventsQueryKey() } });
  const create = useCreatePortalEvent();
  const update = useUpdatePortalEvent();
  const remove = useDeletePortalEvent();
  const [form, setForm] = useState<Form | null>(null);
  const [deleting, setDeleting] = useState<PortalEvent | null>(null);
  const pending = create.isPending || update.isPending || remove.isPending;
  const [showPast, setShowPast] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListPortalEventsQueryKey() });
  const save = async () => {
    if (!form) return;
    const { id, ...body } = form;
    try {
      if (id) await update.mutateAsync({ id, data: body }); else await create.mutateAsync({ data: body });
      toast({ title: id ? "Event updated" : "Event added" });
      setForm(null);
      await refresh();
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  const togglePublish = async (e: PortalEvent) => {
    try {
      await update.mutateAsync({ id: e.id, data: { ...e, published: !e.published } });
      toast({ title: e.published ? "Event hidden" : "Event published" });
      await refresh();
    } catch (err) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(err) }); }
  };
  const confirmDelete = async (e: PortalEvent) => {
    try { await remove.mutateAsync({ id: e.id }); toast({ title: "Event deleted" }); await refresh(); }
    catch (err) { toast({ variant: "destructive", title: "Not deleted", description: errorMessage(err) }); }
  };

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  const blank = (): Form => ({ title: "", details: "", venue: "", category: "general", startsAt: tomorrow.toISOString(), endsAt: null, allDay: false, classId: null, published: true });
  const now = Date.now();
  const events = list.data ?? [];
  const isPast = (e: PortalEvent) => new Date(e.endsAt ?? e.startsAt).getTime() + (e.allDay ? 86_400_000 : 0) < now;
  const shown = events.filter((e) => showPast ? isPast(e) : !isPast(e));
  if (showPast) shown.reverse();
  const items = new Map(calendarItems(shown, []).map((i) => [i.key, i]));

  if (list.isError) return <ErrorPanel title="Events did not load" message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-xl border border-[hsl(var(--p-line))] p-1 text-sm" role="group" aria-label="Which events">
          <button type="button" className={"rounded-lg px-3 py-1.5 font-semibold " + (!showPast ? "bg-[hsl(var(--p-emerald))] text-white" : "")} aria-pressed={!showPast} onClick={() => setShowPast(false)} data-testid="button-events-upcoming">Upcoming</button>
          <button type="button" className={"rounded-lg px-3 py-1.5 font-semibold " + (showPast ? "bg-[hsl(var(--p-emerald))] text-white" : "")} aria-pressed={showPast} onClick={() => setShowPast(true)} data-testid="button-events-past">Past</button>
        </div>
        <button className="portal-btn" onClick={() => setForm(blank())} data-testid="button-add-event"><Plus size={15} /> New event</button>
      </div>
      {list.isLoading ? <Skeleton className="h-40" /> : shown.length === 0
        ? <EmptyState icon={<CalendarDays size={22} />} title={showPast ? "No past events" : "No upcoming events"} body="Add sports days, PTA meetings, holidays and trips. Students see them on their calendar and home screen." />
        : (
          <div className="space-y-3">{shown.map((e) => {
            const it = items.get("event:" + e.id)!;
            return (
              <div key={e.id} className="portal-card flex flex-col gap-3 p-5 sm:flex-row sm:items-start" data-testid={"card-event-" + e.id}>
                <span className="grid h-14 w-12 shrink-0 place-items-center rounded-xl text-center" style={{ background: `hsl(${it.hue} / 0.12)`, color: `hsl(${it.hue})` }}>
                  <span className="leading-tight"><span className="block text-[10px] font-bold uppercase">{new Intl.DateTimeFormat("en-NG", { month: "short" }).format(it.start)}</span><span className="block text-lg font-bold">{it.start.getDate()}</span></span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><StatusPill tone={e.published ? "green" : "muted"}>{e.published ? "Published" : "Draft"}</StatusPill><span className="text-xs font-semibold" style={{ color: `hsl(${it.hue})` }}>{it.label}</span></div>
                  <p className="mt-1.5 font-serif text-lg font-semibold">{e.title}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[hsl(var(--p-ink)/0.62)]">
                    <span className="flex items-center gap-1"><Clock size={12} /> {new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short" }).format(it.start)}, {whenText(it)}</span>
                    {e.venue && <span className="flex items-center gap-1"><MapPin size={12} /> {e.venue}</span>}
                    <span className="flex items-center gap-1"><Users size={12} /> {e.className ?? "Whole school"}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="portal-btn-ghost" onClick={() => setForm({ ...e })} data-testid={"button-edit-event-" + e.id}><Pencil size={13} /> Edit</button>
                  <button className="portal-btn-ghost" disabled={pending} onClick={() => void togglePublish(e)} data-testid={"button-toggle-event-" + e.id}>{e.published ? "Unpublish" : "Publish"}</button>
                  <button className="portal-btn-ghost" disabled={pending} onClick={() => setDeleting(e)} data-testid={"button-delete-event-" + e.id}><Trash2 size={13} /> Delete</button>
                </div>
              </div>
            );
          })}</div>
        )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit event" : "New event"}</DialogTitle><DialogDescription>Published events show on the student calendar and home screen.</DialogDescription></DialogHeader>
          {form && <div className="space-y-4">
            <Field label="Title" htmlFor="ev-title"><input id="ev-title" className="portal-input" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-event-title" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="ev-cat">
                <select id="ev-cat" className="portal-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Form["category"] })} data-testid="select-event-category">
                  {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Who it is for" htmlFor="ev-class">
                <select id="ev-class" className="portal-input" value={form.classId ?? ""} onChange={(e) => setForm({ ...form, classId: e.target.value ? Number(e.target.value) : null })} data-testid="select-event-class">
                  <option value="">Whole school</option>
                  {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allDay} onChange={(e) => {
              const allDay = e.target.checked;
              setForm({ ...form, allDay, startsAt: fromLocalInput(toLocalInput(form.startsAt, allDay), allDay) ?? form.startsAt, endsAt: form.endsAt ? fromLocalInput(toLocalInput(form.endsAt, allDay), allDay) : null });
            }} data-testid="checkbox-event-allday" /> All day</label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" htmlFor="ev-start"><input id="ev-start" type={form.allDay ? "date" : "datetime-local"} className="portal-input" value={toLocalInput(form.startsAt, form.allDay)} onChange={(e) => setForm({ ...form, startsAt: fromLocalInput(e.target.value, form.allDay) ?? "" })} data-testid="input-event-start" /></Field>
              <Field label="Ends (optional)" htmlFor="ev-end"><input id="ev-end" type={form.allDay ? "date" : "datetime-local"} className="portal-input" value={toLocalInput(form.endsAt, form.allDay)} onChange={(e) => setForm({ ...form, endsAt: fromLocalInput(e.target.value, form.allDay) })} data-testid="input-event-end" /></Field>
            </div>
            <Field label="Venue" htmlFor="ev-venue"><input id="ev-venue" className="portal-input" maxLength={200} placeholder="e.g. School hall" value={form.venue ?? ""} onChange={(e) => setForm({ ...form, venue: e.target.value })} data-testid="input-event-venue" /></Field>
            <Field label="Details" htmlFor="ev-details"><textarea id="ev-details" className="portal-input min-h-[110px]" maxLength={5000} value={form.details ?? ""} onChange={(e) => setForm({ ...form, details: e.target.value })} data-testid="input-event-details" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} data-testid="checkbox-event-published" /> Published</label>
          </div>}
          <DialogFooter><button className="portal-btn" onClick={() => void save()} disabled={pending || !form?.title.trim() || !form?.startsAt} data-testid="button-save-event">{pending ? "Saving..." : "Save event"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="font-serif text-2xl">Delete "{deleting?.title}"?</AlertDialogTitle><AlertDialogDescription>The event is removed from every student's calendar.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-event" onClick={() => { if (deleting) void confirmDelete(deleting); setDeleting(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
