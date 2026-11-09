import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { ApiError, getGetExamOfficerOverviewQueryKey, useGetExamOfficerOverview } from "@workspace/api-client-react";
import { Activity, CalendarRange, FileCheck2, Inbox, LayoutDashboard } from "lucide-react";
import "@/portal/portal.css";
import { AppShell, type NavItem } from "@/portal/shell/AppShell";
import { usePortalTheme } from "@/portal/shell/theme";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { IdleSignOut } from "@/components/IdleSignOut";
import { ActivityView, AllExamsView, OverviewView, PaperDialog, QueueView, type OfficerTab } from "@/portal/exam-officer/OfficerViews";
import { asset } from "@/lib/asset";
import { TimetablesPanel } from "@/portal/Timetables";

const TITLES: Record<OfficerTab, string> = { overview: "Overview", queue: "Publishing queue", exams: "All exams", timetables: "Exam timetables", activity: "Staff exam activity" };

function Gate({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <main className="portal grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <img src={asset("/logo.jpg")} alt="New World Emerald Private School" className="mx-auto h-16 w-16 object-contain" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold-ink))]">Exam officer</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.7)]">{body}</p>
        <div className="mt-7 space-y-3">{children}</div>
        <div className="mt-8"><BackToWebsite /></div>
      </div>
    </main>
  );
}

export default function ExamOfficer() {
  usePortalMeta("Exam officer");
  const theme = usePortalTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const signedIn = isLoaded && isSignedIn === true;
  const [tab, setTab] = useState<OfficerTab>("overview");
  const [term, setTerm] = useState<string | undefined>(undefined);
  const [viewing, setViewing] = useState<number | null>(null);
  const params = term ? { term } : {};
  // Right after signing up, the server needs a few seconds to confirm the new account.
  const q = useGetExamOfficerOverview(params, { query: { queryKey: [...getGetExamOfficerOverviewQueryKey(params), user?.id ?? "anon"], enabled: signedIn, refetchInterval: 60_000, retry: (n, e) => e instanceof ApiError && e.status === 403 && n < 6, retryDelay: 5000 } });
  const leave = () => void signOut({ redirectUrl: import.meta.env.BASE_URL + "exam-officer" });

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) return <Gate title="Exam officer's portal" body="Publish every exam to students, and see what staff do with exams and results. Sign in with the exam officer's email."><Link href="/sign-in?returnTo=exam-officer" className="portal-btn w-full justify-center !py-3.5" data-testid="link-officer-signin">Sign in with email</Link></Gate>;
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 401)) {
    return <Gate title="For the exam officer only" body="This page is for the school's exam officer. If that is you, sign in with the email the school registered for you."><button type="button" className="portal-btn-ghost w-full justify-center" onClick={leave} data-testid="button-officer-switch">Use another account</button></Gate>;
  }
  if (q.isLoading) return <div className="portal p-10"><Skeleton className="mx-auto h-60 max-w-3xl" /></div>;
  if (q.isError || !q.data) return <div className="portal grid min-h-screen place-items-center px-4"><div className="w-full max-w-md"><ErrorPanel title="The exam officer's portal did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} /></div></div>;

  const waiting = q.data.exams.filter((e) => e.status === "awaiting").length;
  const nav: NavItem<OfficerTab>[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard, testId: "tab-officer-overview" },
    { key: "queue", label: "Publishing queue", icon: Inbox, testId: "tab-officer-queue", ...(waiting ? { badge: waiting } : {}) },
    { key: "exams", label: "All exams", icon: FileCheck2, testId: "tab-officer-exams" },
    { key: "timetables", label: "Timetables", icon: CalendarRange, testId: "tab-officer-timetables" },
    { key: "activity", label: "Staff activity", icon: Activity, testId: "tab-officer-activity" },
  ];
  return (
    <AppShell subtitle="Exam officer" groups={[{ items: nav }]} active={tab} onNavigate={(k) => setTab(k as OfficerTab)}
      title={TITLES[tab]} eyebrow="New World Emerald Private School"
      user={{ name: user?.fullName || "Exam officer", detail: user?.primaryEmailAddress?.emailAddress ?? "" }} theme={theme.theme} onTheme={theme.setTheme}
      onSignOut={leave} bottomNav={[nav[0], { ...nav[1], label: "Queue" }, { ...nav[2], label: "Exams" }, { ...nav[4], label: "Activity" }]}>
      <IdleSignOut enabled onSignOut={leave} />
      <div className="px-4 pb-6 pt-4 lg:px-0 lg:pt-0">
        {tab === "overview" && <OverviewView data={q.data} name={user?.fullName ?? ""} onOpen={setTab} onView={setViewing} />}
        {tab === "queue" && <QueueView data={q.data} onView={setViewing} />}
        {tab === "exams" && <AllExamsView data={q.data} onTerm={setTerm} onView={setViewing} />}
        {tab === "timetables" && <TimetablesPanel />}
        {tab === "activity" && <ActivityView />}
      </div>
      {viewing !== null && <PaperDialog id={viewing} onClose={() => setViewing(null)} />}
    </AppShell>
  );
}
