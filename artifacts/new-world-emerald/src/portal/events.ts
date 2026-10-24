import type { PortalDashboard, PortalEvent } from "@workspace/api-client-react";

export const CATEGORIES: Record<PortalEvent["category"], { label: string; hue: string }> = {
  general: { label: "General", hue: "152 55% 36%" },
  academic: { label: "Academic", hue: "212 75% 48%" },
  exam: { label: "Exam", hue: "41 80% 42%" },
  sports: { label: "Sports", hue: "18 80% 50%" },
  holiday: { label: "Holiday", hue: "330 65% 52%" },
  meeting: { label: "Meeting", hue: "262 55% 55%" },
  cultural: { label: "Cultural", hue: "183 60% 34%" },
};

/** One thing on the calendar: a school event or one of the student's exams. */
export type CalendarItem = {
  key: string; kind: "event" | "exam"; title: string; start: Date; end: Date | null; allDay: boolean;
  venue: string; details: string; hue: string; label: string; scope: string; examId?: number;
};

export function calendarItems(events: PortalEvent[] | undefined, exams: PortalDashboard["exams"]): CalendarItem[] {
  const items: CalendarItem[] = (events ?? []).map((e) => ({
    key: "event:" + e.id, kind: "event", title: e.title, start: new Date(e.startsAt), end: e.endsAt ? new Date(e.endsAt) : null,
    allDay: e.allDay, venue: e.venue, details: e.details, hue: CATEGORIES[e.category]?.hue ?? CATEGORIES.general.hue,
    label: CATEGORIES[e.category]?.label ?? "Event", scope: e.className ?? "Whole school",
  }));
  for (const x of exams) items.push({
    key: "exam:" + x.id, kind: "exam", title: x.title, start: new Date(x.startsAt), end: new Date(x.endsAt), allDay: false,
    venue: x.subject, details: `${x.durationMinutes} minutes, ${x.questionCount} questions`, hue: CATEGORIES.exam.hue, label: "Exam", scope: "Your class", examId: x.id,
  });
  return items.sort((a, b) => a.start.getTime() - b.start.getTime());
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

/** Whether an item happens on a day, counting every day a multi-day event spans. */
export function onDay(item: CalendarItem, day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const next = new Date(start.getTime() + 86_400_000);
  const end = item.end && item.end > item.start ? item.end : item.start;
  return item.start < next && end >= start;
}

/** Weeks (Monday first) covering a month; each cell is a date, null outside the month. */
export function monthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Items still to come (or happening now), soonest first. */
export function upcomingItems(items: CalendarItem[], now: number, limit: number) {
  return items.filter((i) => (i.end ?? new Date(i.start.getTime() + 86_400_000)).getTime() > now).slice(0, limit);
}

export function whenText(item: CalendarItem) {
  const time = (d: Date) => new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit" }).format(d);
  const date = (d: Date) => new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short" }).format(d);
  if (item.allDay) return item.end && !sameDay(item.start, item.end) ? `${date(item.start)} - ${date(item.end)}` : "All day";
  if (item.end && !sameDay(item.start, item.end)) return `${date(item.start)} ${time(item.start)} - ${date(item.end)}`;
  return item.end ? `${time(item.start)} - ${time(item.end)}` : time(item.start);
}
