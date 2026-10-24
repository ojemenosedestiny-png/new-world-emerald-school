import { useMemo, useState } from "react";
import { useListPortalEvents, getListPortalEventsQueryKey, type PortalDashboard } from "@workspace/api-client-react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Users } from "lucide-react";
import { ErrorPanel, Skeleton } from "./ui";
import { errorMessage } from "./lib";
import { calendarItems, monthGrid, onDay, sameDay, upcomingItems, whenText, type CalendarItem } from "./events";
import type { StudentSection } from "./StudentHome";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ItemRow({ item, onGo }: { item: CalendarItem; onGo: (s: StudentSection) => void }) {
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-NG", o).format(item.start);
  const body = (
    <>
      <span className="grid h-14 w-12 shrink-0 place-items-center rounded-xl text-center" style={{ background: `hsl(${item.hue} / 0.12)`, color: `hsl(${item.hue})` }}>
        <span className="leading-tight"><span className="block text-[10px] font-bold uppercase">{fmt({ month: "short" })}</span><span className="block text-lg font-bold">{fmt({ day: "numeric" })}</span></span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="truncate font-semibold">{item.title}</span><span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `hsl(${item.hue} / 0.12)`, color: `hsl(${item.hue})` }}>{item.label}</span></span>
        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[hsl(var(--p-ink)/0.62)]">
          <span className="flex items-center gap-1"><Clock size={12} aria-hidden="true" /> {whenText(item)}</span>
          {item.venue && <span className="flex items-center gap-1"><MapPin size={12} aria-hidden="true" /> {item.venue}</span>}
          <span className="flex items-center gap-1"><Users size={12} aria-hidden="true" /> {item.scope}</span>
        </span>
        {item.kind === "event" && item.details && <span className="mt-1 block whitespace-pre-wrap text-sm text-[hsl(var(--p-ink)/0.75)]">{item.details}</span>}
      </span>
    </>
  );
  return item.kind === "exam"
    ? <li><button type="button" onClick={() => onGo("exams")} className="flex w-full items-start gap-3 p-4 text-left hover:bg-[hsl(var(--p-paper-2)/0.5)]" data-testid={"cal-item-" + item.key}>{body}</button></li>
    : <li className="flex items-start gap-3 p-4" data-testid={"cal-item-" + item.key}>{body}</li>;
}

/** Month calendar of school events and the student's exams, with the chosen day and what is coming up. */
export function StudentEvents({ data, onGo }: { data: PortalDashboard; onGo: (s: StudentSection) => void }) {
  const events = useListPortalEvents({ query: { queryKey: getListPortalEventsQueryKey() } });
  const today = new Date();
  const [month, setMonth] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState(today);
  const items = useMemo(() => calendarItems(events.data, data.exams), [events.data, data.exams]);
  const weeks = monthGrid(month.y, month.m);
  const dayItems = items.filter((i) => onDay(i, selected));
  const upcoming = upcomingItems(items, Date.now(), 8);
  const shift = (d: number) => setMonth(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));
  const title = new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric" }).format(new Date(month.y, month.m, 1));
  const long = (d: Date) => new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long" }).format(d);

  if (events.isError) return <div className="px-4 lg:px-0"><ErrorPanel title="The calendar could not load" message={errorMessage(events.error)} onRetry={() => events.refetch()} /></div>;
  return (
    <div className="grid gap-5 px-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:px-0">
      <section className="portal-card p-4 sm:p-5" aria-label="Month calendar" data-testid="panel-calendar">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className="grid h-9 w-9 place-items-center rounded-full hover:bg-[hsl(var(--p-paper-2))]" onClick={() => shift(-1)} aria-label="Previous month" data-testid="button-prev-month"><ChevronLeft size={18} /></button>
          <h2 className="font-serif text-xl font-semibold" data-testid="text-month">{title}</h2>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-full hover:bg-[hsl(var(--p-paper-2))]" onClick={() => shift(1)} aria-label="Next month" data-testid="button-next-month"><ChevronRight size={18} /></button>
        </div>
        <table className="w-full table-fixed border-separate border-spacing-1 text-center">
          <thead><tr>{WEEKDAYS.map((d) => <th key={d} scope="col" className="pb-1 text-[11px] font-semibold uppercase text-[hsl(var(--p-ink)/0.5)]">{d}</th>)}</tr></thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>{week.map((day, i) => {
                if (!day) return <td key={i} />;
                const has = items.filter((it) => onDay(it, day));
                const isSel = sameDay(day, selected), isToday = sameDay(day, today);
                return (
                  <td key={i}>
                    <button type="button" onClick={() => setSelected(day)} aria-pressed={isSel}
                      aria-label={long(day) + (has.length ? `, ${has.length} ${has.length === 1 ? "item" : "items"}` : "")}
                      className={"flex h-11 w-full flex-col items-center justify-center rounded-xl text-sm transition-colors " + (isSel ? "bg-[hsl(var(--p-emerald))] font-bold text-white" : isToday ? "bg-[hsl(var(--p-emerald-soft))] font-bold text-[hsl(var(--p-emerald))]" : "hover:bg-[hsl(var(--p-paper-2))]")}
                      data-testid={`day-${day.getDate()}`}>
                      {day.getDate()}
                      <span className="mt-0.5 flex h-1.5 gap-0.5" aria-hidden="true">{has.slice(0, 3).map((it) => <span key={it.key} className="h-1.5 w-1.5 rounded-full" style={{ background: isSel ? "white" : `hsl(${it.hue})` }} />)}</span>
                    </button>
                  </td>
                );
              })}</tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 border-t border-[hsl(var(--p-line))] pt-3">
          <h3 className="mb-1 text-sm font-semibold" data-testid="text-selected-day">{long(selected)}</h3>
          {events.isLoading ? <Skeleton className="h-16" /> : dayItems.length === 0
            ? <p className="py-3 text-sm text-[hsl(var(--p-ink)/0.6)]">Nothing on this day.</p>
            : <ul className="-mx-4 divide-y divide-[hsl(var(--p-line))]" data-testid="list-day">{dayItems.map((it) => <ItemRow key={it.key} item={it} onGo={onGo} />)}</ul>}
        </div>
      </section>
      <section aria-label="Upcoming events">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><CalendarDays size={18} className="text-[hsl(var(--p-emerald))]" /> Upcoming</h2>
        {events.isLoading ? <Skeleton className="h-40" /> : upcoming.length === 0
          ? <p className="portal-card px-4 py-8 text-center text-sm text-[hsl(var(--p-ink)/0.6)]">No events coming up. School events and your exams appear here.</p>
          : <ul className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden" data-testid="list-upcoming">{upcoming.map((it) => <ItemRow key={it.key} item={it} onGo={onGo} />)}</ul>}
      </section>
    </div>
  );
}
