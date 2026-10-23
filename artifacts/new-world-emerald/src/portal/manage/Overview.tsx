import type { ReactNode } from "react";
import type { PortalManagement } from "@workspace/api-client-react";
import { ClipboardCheck, GraduationCap, PenLine, Radio } from "lucide-react";
import { examWindow } from "../lib";

export function overviewCounts(data: PortalManagement, now = Date.now()) {
  return {
    students: data.students.filter((s) => s.active).length,
    openExams: data.exams.filter((e) => e.published && examWindow(e.startsAt, e.endsAt, now) === "open").length,
    writing: data.attempts.filter((a) => a.status === "in_progress" && new Date(a.deadline).getTime() > now).length,
    toMark: data.attempts.filter((a) => a.status === "submitted").length,
  };
}

function Stat({ icon, label, value, tone, testId }: { icon: ReactNode; label: string; value: number; tone?: "live" | "attention"; testId: string }) {
  const accent = tone === "live" && value > 0 ? "text-[hsl(var(--p-emerald))]" : tone === "attention" && value > 0 ? "text-[hsl(36_70%_35%)]" : "text-[hsl(var(--p-ink)/0.45)]";
  return (
    <div className="portal-card flex items-center gap-3 p-4" data-testid={testId}>
      <div className={"grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--p-paper-2))] " + accent}>{icon}</div>
      <div><p className="font-serif text-2xl font-semibold leading-none">{value}</p><p className="mt-1 text-xs text-[hsl(var(--p-ink)/0.6)]">{label}</p></div>
    </div>
  );
}

export function ManageOverview({ data }: { data: PortalManagement }) {
  const c = overviewCounts(data);
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Portal overview">
      <Stat icon={<GraduationCap size={18} />} label="Active students" value={c.students} testId="stat-students" />
      <Stat icon={<Radio size={18} />} label="Exams open now" value={c.openExams} tone="live" testId="stat-open-exams" />
      <Stat icon={<PenLine size={18} />} label="Writing right now" value={c.writing} tone="live" testId="stat-writing" />
      <Stat icon={<ClipboardCheck size={18} />} label="Awaiting marking" value={c.toMark} tone="attention" testId="stat-to-mark" />
    </div>
  );
}
