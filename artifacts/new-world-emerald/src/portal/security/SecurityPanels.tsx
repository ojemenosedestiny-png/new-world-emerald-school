import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuditLog, getGetAuditLogQueryKey, useGetSecuritySessions, getGetSecuritySessionsQueryKey, useRevokeSessions,
  useGetStudentActivity, getGetStudentActivityQueryKey,
  type AuditEntry, type GetAuditLogParams, type RevokeRequest,
} from "@workspace/api-client-react";
import { ChevronDown, Download, LogOut, MonitorSmartphone, Search, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage, formatDateTime } from "../lib";
import { downloadCsv } from "../manage/results";

/** Short, readable device description from a user-agent string. */
export function deviceLabel(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function useRevoke() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const m = useRevokeSessions();
  const run = async (data: RevokeRequest, done: string) => {
    try {
      const res = await m.mutateAsync({ data });
      toast({ title: done, description: res.message !== done ? res.message : undefined });
      await queryClient.invalidateQueries({ queryKey: getGetSecuritySessionsQueryKey() });
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Not signed out", description: errorMessage(e) }); return false; }
  };
  return { run, pending: m.isPending };
}

export function SessionsPanel() {
  const q = useGetSecuritySessions({ query: { queryKey: getGetSecuritySessionsQueryKey(), refetchInterval: 30000 } });
  const revoke = useRevoke();
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>;
  if (q.isError || !q.data) return <ErrorPanel title="Sessions did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { students, staff, staffAvailable } = q.data;
  return (
    <div className="space-y-6">
      <section className="portal-card overflow-hidden" aria-label="Staff sessions">
        <div className="border-b border-[hsl(var(--p-line))] px-5 py-3"><h2 className="text-[15px] font-semibold">Staff sign-ins</h2><p className="text-xs text-[hsl(var(--p-ink)/0.55)]">Administrators and teachers signed in with their school email</p></div>
        {!staffAvailable ? <p className="px-5 py-4 text-sm text-[hsl(var(--p-ink)/0.6)]">Staff sessions could not be loaded from the sign-in service right now.</p>
          : staff.length === 0 ? <p className="px-5 py-4 text-sm text-[hsl(var(--p-ink)/0.6)]">No staff are signed in.</p> : (
          <ul className="divide-y divide-[hsl(var(--p-line))]">
            {staff.map((s) => (
              <li key={s.sessionId} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid={"staff-session-" + s.sessionId}>
                <ShieldCheck size={16} className="text-[hsl(var(--p-emerald))]" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{s.email}</span><span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">{s.role}{s.lastActiveAt ? ` / last active ${formatDateTime(s.lastActiveAt)}` : ""}</span></span>
                <button className="portal-btn-ghost !py-1 text-xs" disabled={revoke.pending} onClick={() => { if (window.confirm(`Sign ${s.email} out of this session?`)) void revoke.run({ kind: "staff", sessionId: s.sessionId }, "Staff session ended"); }}><LogOut size={12} /> Sign out</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="portal-card overflow-hidden" aria-label="Student sessions">
        <div className="border-b border-[hsl(var(--p-line))] px-5 py-3"><h2 className="text-[15px] font-semibold">Student sessions</h2><p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{students.length} active / sessions last up to 12 hours</p></div>
        {students.length === 0 ? <EmptyState icon={<MonitorSmartphone size={22} />} title="No students signed in" body="Active student portal sessions appear here." /> : (
          <ul className="divide-y divide-[hsl(var(--p-line))]">
            {students.map((s) => (
              <li key={s.ref} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid={"student-session-" + s.ref}>
                <MonitorSmartphone size={16} className="opacity-60" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{s.name} <span className="font-mono text-xs opacity-50">{s.studentCode}</span></span><span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">{s.className} / {deviceLabel(s.userAgent)}{s.ip ? ` / ${s.ip}` : ""}{s.createdAt ? ` / since ${formatDateTime(s.createdAt)}` : ""}</span></span>
                <button className="portal-btn-ghost !py-1 text-xs" disabled={revoke.pending} onClick={() => void revoke.run({ kind: "studentSession", ref: s.ref }, "Session ended")}><LogOut size={12} /> Sign out</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function auditCsv(entries: AuditEntry[]) {
  const cell = (v: unknown) => { let t = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const head = ["Time", "Actor", "Kind", "Action", "Target", "Outcome", "Status", "IP", "Before", "After"];
  return [head, ...entries.map((e) => [e.at, e.actorLabel, e.actorKind, e.action, e.targetType ? `${e.targetType} ${e.targetId ?? ""}` : "", e.outcome, e.status, e.ip, e.before, e.after])].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function AuditLogPanel() {
  const [draft, setDraft] = useState({ q: "", actorKind: "", outcome: "", from: "", to: "" });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const params: GetAuditLogParams = {
    page, pageSize: 50, ...(filters.q ? { q: filters.q } : {}),
    ...(filters.actorKind ? { actorKind: filters.actorKind as GetAuditLogParams["actorKind"] } : {}),
    ...(filters.outcome ? { outcome: filters.outcome as GetAuditLogParams["outcome"] } : {}),
    ...(filters.from ? { from: new Date(filters.from).toISOString() } : {}),
    ...(filters.to ? { to: new Date(filters.to + "T23:59:59").toISOString() } : {}),
  };
  const q = useGetAuditLog(params, { query: { queryKey: getGetAuditLogQueryKey(params), placeholderData: (p) => p } });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const tone = (o: string) => (o === "success" ? "green" : o === "denied" ? "red" : "gold") as "green" | "red" | "gold";
  return (
    <div className="space-y-4">
      <form className="portal-card grid gap-2 p-4 md:grid-cols-[1fr_auto_auto_auto_auto_auto]" onSubmit={(e) => { e.preventDefault(); setPage(1); setFilters(draft); }}>
        <label className="relative"><span className="sr-only">Search</span><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" /><input className="portal-input !py-2 pl-8 text-sm" placeholder="Search action, person, record or IP" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} data-testid="input-audit-search" /></label>
        <select className="portal-input !py-2 text-sm" aria-label="Who" value={draft.actorKind} onChange={(e) => setDraft({ ...draft, actorKind: e.target.value })}><option value="">Everyone</option><option value="staff">Staff</option><option value="student">Students</option><option value="system">System</option></select>
        <select className="portal-input !py-2 text-sm" aria-label="Result" value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}><option value="">Any result</option><option value="success">Success</option><option value="denied">Denied</option><option value="failed">Failed</option></select>
        <input type="date" className="portal-input !py-2 text-sm" aria-label="From date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        <input type="date" className="portal-input !py-2 text-sm" aria-label="To date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        <button className="portal-btn !py-2" data-testid="button-audit-filter">Apply</button>
      </form>
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError || !q.data ? <ErrorPanel title="Audit log did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : (
        <section className="portal-card overflow-hidden" aria-label="Audit entries">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--p-line))] px-5 py-3">
            <p className="text-sm"><b>{q.data.total.toLocaleString()}</b> entries <span className="text-xs text-[hsl(var(--p-ink)/0.55)]">/ read-only</span></p>
            <button className="portal-btn-ghost !py-1 text-xs" disabled={!q.data.entries.length} onClick={() => downloadCsv(`audit-log-page-${page}.csv`, auditCsv(q.data!.entries))} data-testid="button-audit-export"><Download size={12} /> Export this page</button>
          </div>
          {q.data.entries.length === 0 ? <p className="px-5 py-8 text-center text-sm text-[hsl(var(--p-ink)/0.55)]">No entries match these filters.</p> : (
            <ul className="divide-y divide-[hsl(var(--p-line))]">
              {q.data.entries.map((e) => (
                <li key={e.id} data-testid={"audit-row-" + e.id}>
                  <button className="flex w-full flex-wrap items-center gap-3 px-5 py-2.5 text-left hover:bg-[hsl(var(--p-paper-2)/0.5)]" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                    <span className="w-36 shrink-0 text-xs tabular-nums text-[hsl(var(--p-ink)/0.6)]">{formatDateTime(e.at)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{e.action}</span><span className="block truncate text-xs text-[hsl(var(--p-ink)/0.6)]">{e.actorLabel || e.actorKind}{e.targetType ? ` / ${e.targetType} ${e.targetId ?? ""}` : ""}{e.ip ? ` / ${e.ip}` : ""}</span></span>
                    <StatusPill tone={tone(e.outcome)}>{e.outcome}{e.status ? ` ${e.status}` : ""}</StatusPill>
                    <ChevronDown size={14} className={"shrink-0 transition-transform " + (open === e.id ? "rotate-180" : "")} />
                  </button>
                  {open === e.id && (
                    <div className="grid gap-3 bg-[hsl(var(--p-paper-2)/0.4)] px-5 py-3 text-xs md:grid-cols-2">
                      {(["before", "after"] as const).map((k) => <div key={k}><p className="portal-label mb-1">{k}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[hsl(var(--p-surface)/0.8)] p-2 font-mono">{e[k] === null || e[k] === undefined ? "-" : JSON.stringify(e[k], null, 2)}</pre></div>)}
                      <p className="md:col-span-2 text-[hsl(var(--p-ink)/0.55)]">{e.userAgent ? deviceLabel(e.userAgent) : ""}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-[hsl(var(--p-line))] px-5 py-2.5 text-sm">
            <button className="portal-btn-ghost !py-1 text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
            <span className="text-xs text-[hsl(var(--p-ink)/0.6)]">Page {page} of {pages}</span>
            <button className="portal-btn-ghost !py-1 text-xs" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</button>
          </div>
        </section>
      )}
    </div>
  );
}

export function StudentActivityDialogBody({ studentId, name }: { studentId: number; name: string }) {
  const q = useGetStudentActivity(studentId, { query: { queryKey: getGetStudentActivityQueryKey(studentId) } });
  const revoke = useRevoke();
  const queryClient = useQueryClient();
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError || !q.data) return <ErrorPanel title="Activity did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { logins, activeSessions } = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[hsl(var(--p-paper-2)/0.6)] p-3 text-sm">
        <span><b>{activeSessions}</b> active {activeSessions === 1 ? "session" : "sessions"}</span>
        <button className="portal-btn-ghost !py-1 text-xs" disabled={!activeSessions || revoke.pending} onClick={async () => { if (await revoke.run({ kind: "student", studentId }, `${name} signed out everywhere`)) await queryClient.invalidateQueries({ queryKey: getGetStudentActivityQueryKey(studentId) }); }} data-testid="button-signout-everywhere"><LogOut size={12} /> Sign out everywhere</button>
      </div>
      <div>
        <p className="portal-label mb-2">Recent sign-ins</p>
        {logins.length === 0 ? <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">No sign-ins recorded yet.</p> : (
          <ul className="max-h-72 divide-y divide-[hsl(var(--p-line))] overflow-y-auto rounded-xl border border-[hsl(var(--p-line))]">
            {logins.map((l, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                <StatusPill tone={l.success ? "green" : "red"}>{l.success ? "Signed in" : "Failed"}</StatusPill>
                <span className="min-w-0 flex-1 truncate text-xs text-[hsl(var(--p-ink)/0.65)]">{deviceLabel(l.userAgent)}{l.ip ? ` / ${l.ip}` : ""}</span>
                <span className="shrink-0 text-xs tabular-nums text-[hsl(var(--p-ink)/0.6)]">{formatDateTime(l.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
