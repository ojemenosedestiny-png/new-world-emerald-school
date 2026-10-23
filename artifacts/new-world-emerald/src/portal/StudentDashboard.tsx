import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPortalDashboard, getGetPortalDashboardQueryKey, useStartPortalExam, useLogoutPortalStudent,
  getGetPortalSessionQueryKey,
  type PortalSession, type PortalDashboardExamsItem, type PortalDashboardAttemptsItem,
} from "@workspace/api-client-react";
import { Award, BookOpen, CalendarClock, ClipboardList, FileBarChart, FileText, Home, KeyRound, Megaphone, PlayCircle, Timer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "./ui";
import { PasswordChange } from "./PasswordChange";
import { clearDrafts, clearStudentQueries, errorMessage, examWindow, fileUrl, formatDateTime, sortStudentExams } from "./lib";
import { studentAverage } from "./manage/results";
import { StudentReports } from "./reports/StudentReports";
import { StudentHome, type StudentSection } from "./StudentHome";
import { AppShell, type NavGroup } from "./shell/AppShell";
import type { usePortalTheme } from "./shell/theme";

export function useStudentLogout() {
  const queryClient = useQueryClient();
  const logout = useLogoutPortalStudent();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const run = () =>
    logout.mutate(undefined, {
      onSuccess: async () => {
        clearDrafts();
        await clearStudentQueries(queryClient);
        queryClient.setQueryData(getGetPortalSessionQueryKey(), {
          role: "guest", name: "", classIds: [], mustChangePassword: false,
        });
        setLocation("/portal");
      },
      onError: (e) => toast({ variant: "destructive", title: "Sign-out failed", description: errorMessage(e) }),
    });
  return { run, pending: logout.isPending };
}

function ExamRow({ exam, attempt }: { exam: PortalDashboardExamsItem; attempt?: PortalDashboardAttemptsItem }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const start = useStartPortalExam();
  const win = examWindow(exam.startsAt, exam.endsAt);
  const inProgress = attempt?.status === "in_progress";
  const done = attempt && !inProgress;

  const begin = () => {
    if (attempt) { setLocation("/portal/exam/" + attempt.id); return; }
    start.mutate({ id: exam.id }, {
      onSuccess: (a) => setLocation("/portal/exam/" + a.id),
      onError: (e) => toast({ variant: "destructive", title: "Could not open exam", description: errorMessage(e) }),
    });
  };

  return (
    <article className="portal-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center" data-testid={"card-exam-" + exam.id}>
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]"><ClipboardList size={24} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--p-ink)/0.55)]">{exam.subject}</span>
          {done ? <StatusPill tone="ink">Submitted</StatusPill> : inProgress ? <StatusPill tone="gold">In progress</StatusPill> : win === "open" ? <StatusPill tone="green">Open now</StatusPill> : win === "upcoming" ? <StatusPill tone="muted">Upcoming</StatusPill> : <StatusPill tone="red">Closed</StatusPill>}
        </div>
        <h3 className="mt-1 font-serif text-xl font-semibold">{exam.title}</h3>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[hsl(var(--p-ink)/0.62)]">
          <span className="inline-flex items-center gap-1"><Timer size={14} /> {exam.durationMinutes} min</span>
          <span>{exam.questionCount} {exam.questionCount === 1 ? "question" : "questions"}, {exam.totalMarks} {exam.totalMarks === 1 ? "mark" : "marks"}</span>
          <span className="inline-flex items-center gap-1"><CalendarClock size={14} /> {formatDateTime(exam.startsAt)} to {formatDateTime(exam.endsAt)}</span>
        </p>
      </div>
      {done ? (
        <button className="portal-btn-ghost" onClick={begin} data-testid={"button-view-attempt-" + exam.id}>View submission</button>
      ) : (
        <button className="portal-btn" onClick={begin} disabled={start.isPending || (!inProgress && win !== "open")} data-testid={"button-start-exam-" + exam.id}>
          <PlayCircle size={16} /> {start.isPending ? "Opening..." : inProgress ? "Resume" : win === "upcoming" ? "Not open yet" : win === "closed" ? "Closed" : "Start exam"}
        </button>
      )}
    </article>
  );
}

export function StudentDashboard({ session, theme }: { session: PortalSession; theme: ReturnType<typeof usePortalTheme> }) {
  const dash = useGetPortalDashboard({ query: { queryKey: getGetPortalDashboardQueryKey(), refetchInterval: 20000 } });
  const logout = useStudentLogout();
  const [, setLocation] = useLocation();
  const [pwOpen, setPwOpen] = useState(false);
  const [section, setSection] = useState<StudentSection>("home");
  const data = dash.data;
  const attemptByExam = useMemo(() => new Map((data?.attempts ?? []).map((a) => [a.examId, a])), [data]);
  const examIds = useMemo(() => new Set((data?.exams ?? []).map((e) => e.id)), [data]);
  const orphanAttempts = (data?.attempts ?? []).filter((a) => !examIds.has(a.examId));
  const exams = useMemo(() => sortStudentExams(data?.exams ?? [], data?.attempts ?? []), [data]);
  const firstName = session.name.split(" ")[0];
  const average = studentAverage(data?.attempts ?? []);

  const nextExam = exams.find((e) => attemptByExam.get(e.id)?.status === "in_progress" || examWindow(e.startsAt, e.endsAt) !== "closed");
  const titles: Record<StudentSection, string> = { home: "Home", exams: "Exams", results: "Results", reports: "Report cards", revision: "Revision notes", notices: "Notices" };
  const openCount = (data?.exams ?? []).filter((e) => examWindow(e.startsAt, e.endsAt) === "open" && attemptByExam.get(e.id)?.status !== "submitted" && attemptByExam.get(e.id)?.status !== "marked").length;
  const groups: NavGroup<StudentSection>[] = [
    { items: [{ key: "home", label: "Home", icon: Home, testId: "tab-home" }] },
    { label: "Learning", items: [
      { key: "exams", label: "Exams", icon: ClipboardList, badge: openCount, testId: "tab-exams" },
      { key: "results", label: "Results", icon: Award, testId: "tab-results" },
      { key: "reports", label: "Report cards", icon: FileBarChart, testId: "tab-reports" },
      { key: "revision", label: "Revision notes", icon: BookOpen, testId: "tab-revision" },
      { key: "notices", label: "Notices", icon: Megaphone, testId: "tab-notices" },
    ] },
  ];

  return (
    <AppShell<StudentSection>
      subtitle="Student Portal" groups={groups} active={section} onNavigate={setSection}
      title={titles[section]} eyebrow={data?.className || "Student portal"}
      user={{ name: session.name, detail: session.studentId ?? "" }}
      theme={theme.theme} onTheme={theme.setTheme}
      onSignOut={logout.run} signingOut={logout.pending}
      actions={dash.isFetching && !dash.isLoading ? <span className="hidden text-xs text-[hsl(var(--p-ink)/0.45)] sm:inline">Checking for updates</span> : undefined}
      sidebarFooter={<button type="button" className="portal-nav-item" onClick={() => setPwOpen(true)} data-testid="button-open-password"><KeyRound size={17} aria-hidden="true" /><span>Change password</span></button>}
    >
        {dash.isLoading ? (
          <div className="space-y-4"><Skeleton className="h-11 w-80" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        ) : dash.isError || !data ? (
          <ErrorPanel title="Your portal could not load" message={errorMessage(dash.error)} onRetry={() => dash.refetch()} />
        ) : (
          <div className="portal-rise" key={section}>
            {section === "home" && <StudentHome data={data} firstName={firstName} studentId={session.studentId ?? ""} average={average} onGo={setSection}
              nextExam={nextExam ? <ExamRow exam={nextExam} attempt={attemptByExam.get(nextExam.id)} /> : null} />}

            {section === "exams" && <div className="space-y-3">
              {data.exams.length === 0 && orphanAttempts.length === 0 ? (
                <EmptyState icon={<ClipboardList size={22} />} title="No exams scheduled" body="When your teacher publishes an exam for your class, it will appear here with its date and time." />
              ) : (
                <>
                  {exams.map((exam) => <ExamRow key={exam.id} exam={exam} attempt={attemptByExam.get(exam.id)} />)}
                  {orphanAttempts.map((a) => (
                    <article key={a.id} className="portal-card flex items-center justify-between gap-4 p-5">
                      <div><p className="text-xs uppercase tracking-widest text-[hsl(var(--p-ink)/0.5)]">{a.subject}</p><p className="font-serif text-lg font-semibold">{a.title}</p></div>
                      <button className="portal-btn-ghost" onClick={() => setLocation("/portal/exam/" + a.id)}>{a.status === "in_progress" ? "Resume" : "View"}</button>
                    </article>
                  ))}
                </>
              )}
            </div>}

            {section === "results" && <div className="space-y-3">
              {average && (
                <div className="portal-card flex items-center justify-between gap-4 p-5" data-testid="card-results-average">
                  <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--p-emerald))]">Your average</p><p className="text-sm text-[hsl(var(--p-ink)/0.6)]">Across {average.count} released {average.count === 1 ? "result" : "results"}</p></div>
                  <p className="font-serif text-4xl font-bold text-[hsl(var(--p-emerald))]">{average.average}%</p>
                </div>
              )}
              {data.attempts.filter((a) => a.status !== "in_progress").length === 0 ? (
                <EmptyState icon={<Award size={22} />} title="No submitted exams yet" body="After you submit an exam, it is listed here. Scores appear once your teacher has marked and released them." />
              ) : (
                data.attempts.filter((a) => a.status !== "in_progress").map((a) => {
                  const released = a.status === "marked" && a.resultsReleased && typeof a.score === "number";
                  return (
                    <button key={a.id} onClick={() => setLocation("/portal/exam/" + a.id)} className="portal-card flex w-full items-center gap-4 p-5 text-left transition-transform hover:-translate-y-0.5" data-testid={"card-result-" + a.id}>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--p-ink)/0.5)]">{a.subject}</p>
                        <p className="font-serif text-lg font-semibold">{a.title}</p>
                      </div>
                      {released ? (
                        <div className="text-right"><p className="font-serif text-3xl font-bold text-[hsl(var(--p-emerald))]">{a.score}<span className="text-base text-[hsl(var(--p-ink)/0.45)]"> / {a.totalMarks}</span></p><p className="text-xs text-[hsl(var(--p-ink)/0.55)]">Released</p></div>
                      ) : (
                        <StatusPill tone="gold">Result pending</StatusPill>
                      )}
                    </button>
                  );
                })
              )}
            </div>}

            {section === "reports" && <StudentReports />}

            {section === "revision" && <div className="grid gap-4 md:grid-cols-2">
              {data.materials.length === 0 ? (
                <div className="md:col-span-2"><EmptyState icon={<BookOpen size={22} />} title="No revision notes yet" body="Your teachers will share class notes and practice material here." /></div>
              ) : (
                data.materials.map((m, i) => (
                  <article key={m.id ?? i} className="portal-card p-6" data-testid={"card-material-" + (m.id ?? i)}>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--p-emerald))]">{m.subject}</p>
                    <h3 className="mt-1 font-serif text-xl font-semibold">{m.title}</h3>
                    {m.body && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--p-ink)/0.78)]">{m.body}</p>}
                    {m.fileId && <a href={fileUrl(m.fileId)} target="_blank" rel="noreferrer" className="portal-btn-ghost mt-4" data-testid={"link-material-file-" + (m.id ?? i)}><FileText size={14} /> Open PDF</a>}
                  </article>
                ))
              )}
            </div>}

            {section === "notices" && <div className="space-y-3">
              {data.notices.length === 0 ? (
                <EmptyState icon={<Megaphone size={22} />} title="No announcements" body="Messages from your class teacher will show up here." />
              ) : (
                data.notices.map((n, i) => (
                  <article key={n.id ?? i} className="portal-card border-l-4 border-l-[hsl(var(--p-gold))] p-6" data-testid={"card-notice-" + (n.id ?? i)}>
                    <h3 className="font-serif text-lg font-semibold">{n.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--p-ink)/0.78)]">{n.body}</p>
                  </article>
                ))
              )}
            </div>}
          </div>
        )}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="portal max-w-md !min-h-0 rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">Change password</DialogTitle><DialogDescription>At least 10 characters. Keep it private.</DialogDescription></DialogHeader>
          <PasswordChange required={false} onDone={() => setPwOpen(false)} />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
