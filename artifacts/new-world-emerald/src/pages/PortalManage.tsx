import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { useGetPortalSession, getGetPortalSessionQueryKey, useGetPortalManagement, getGetPortalManagementQueryKey } from "@workspace/api-client-react";
import { ArrowRight, BookOpen, CheckSquare, ClipboardList, FileBarChart, Globe, GraduationCap, LayoutDashboard, Megaphone, School, ShieldAlert, Users } from "lucide-react";
import "@/portal/portal.css";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { ExamsPanel } from "@/portal/manage/ExamsPanel";
import { MarkingPanel } from "@/portal/manage/MarkingPanel";
import { MaterialsPanel, NoticesPanel } from "@/portal/manage/ContentPanels";
import { ClassesPanel, StudentsPanel, TeachersPanel } from "@/portal/manage/PeoplePanels";
import { Dashboard } from "@/portal/manage/Dashboard";
import { AppShell, type NavGroup } from "@/portal/shell/AppShell";
import { usePortalTheme } from "@/portal/shell/theme";
import { ReportsPanel } from "@/portal/reports/ReportsPanel";

function Gate({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="portal grid place-items-center px-4">
      <div className="portal-card portal-rise w-full max-w-md p-8 text-center">
        <ShieldAlert className="mx-auto text-[hsl(var(--p-emerald))]" size={34} />
        <h1 className="mt-4 font-serif text-3xl font-semibold" data-testid="text-manage-gate">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.65)]">{body}</p>
        <div className="mt-6 space-y-3">{children}</div>
        <div className="mt-6 flex justify-center gap-4"><BackToWebsite /><Link href="/portal" className="text-sm font-medium text-[hsl(var(--p-emerald))]">Student portal</Link></div>
      </div>
    </div>
  );
}

type Section = "overview" | "exams" | "marking" | "reports" | "revision" | "notices" | "students" | "teachers" | "classes";
const TITLES: Record<Section, string> = {
  overview: "Dashboard", exams: "Exams", marking: "Marking", reports: "Report cards", revision: "Revision notes",
  notices: "Announcements", students: "Students", teachers: "Teachers", classes: "Classes",
};

export default function PortalManage() {
  usePortalMeta("Portal Management");
  const theme = usePortalTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [section, setSection] = useState<Section>("overview");
  const signedIn = isLoaded && isSignedIn === true;
  const uid = user?.id ?? "anon";
  const session = useGetPortalSession({ query: { queryKey: [...getGetPortalSessionQueryKey(), "staff", uid], enabled: signedIn, retry: 1 } });
  const role = session.data?.role;
  const isStaff = role === "admin" || role === "teacher";
  const mgmt = useGetPortalManagement({ query: { queryKey: getGetPortalManagementQueryKey(), enabled: signedIn && isStaff, refetchInterval: 20000 } });

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) return <Gate title="Staff sign-in" body="Teachers and school administrators sign in with their approved school email."><Link href="/sign-in?returnTo=portal" className="portal-btn w-full" data-testid="link-staff-signin">Sign in with email</Link></Gate>;
  if (session.isLoading) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (session.isError) return <div className="portal grid place-items-center px-4"><div className="max-w-md"><ErrorPanel title="Could not check your access" message={errorMessage(session.error)} onRetry={() => session.refetch()} /></div></div>;
  if (!isStaff) return <Gate title="Not approved for the portal" body="This account is not an approved teacher or administrator. Ask the school office to approve your email."><button className="portal-btn-ghost w-full justify-center" onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL + "portal/manage" })} data-testid="button-switch-account">Use another account</button></Gate>;

  const isAdmin = role === "admin";
  const d = mgmt.data;
  const toMark = d ? d.attempts.filter((a) => a.status === "submitted").length : 0;
  const writing = d ? d.attempts.filter((a) => a.status === "in_progress" && new Date(a.deadline).getTime() > Date.now()).length : 0;
  const groups: NavGroup<Section>[] = [
    { items: [{ key: "overview", label: "Dashboard", icon: LayoutDashboard, testId: "tab-manage-overview" }] },
    { label: "Teaching", items: [
      { key: "exams", label: "Exams", icon: ClipboardList, badge: writing, testId: "tab-manage-exams" },
      { key: "marking", label: "Marking", icon: CheckSquare, badge: toMark, testId: "tab-manage-marking" },
      { key: "reports", label: "Report cards", icon: FileBarChart, testId: "tab-manage-reports" },
      { key: "revision", label: "Revision notes", icon: BookOpen, testId: "tab-manage-revision" },
      { key: "notices", label: "Announcements", icon: Megaphone, testId: "tab-manage-notices" },
    ] },
    ...(isAdmin ? [{ label: "School", items: [
      { key: "students" as const, label: "Students", icon: GraduationCap, testId: "tab-manage-students" },
      { key: "teachers" as const, label: "Teachers", icon: Users, testId: "tab-manage-teachers" },
      { key: "classes" as const, label: "Classes", icon: School, testId: "tab-manage-classes" },
    ] }] : []),
  ];
  const scope = isAdmin ? "All classes" : (d?.classes.length ?? 0) + " assigned classes";

  return (
    <AppShell<Section>
      subtitle={isAdmin ? "Portal administration" : "Teacher workspace"}
      groups={groups} active={section} onNavigate={setSection}
      title={TITLES[section]} eyebrow={scope}
      user={{ name: session.data?.name || "Staff", detail: isAdmin ? "Administrator" : "Teacher" }}
      theme={theme.theme} onTheme={theme.setTheme}
      onSignOut={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}
      sidebarFooter={isAdmin ? <Link href="/admin" className="portal-nav-item" data-testid="link-admin"><Globe size={17} aria-hidden="true" /><span>Website admin</span></Link> : undefined}
    >
      {mgmt.isLoading ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
        : mgmt.isError || !d ? <ErrorPanel title="Management data did not load" message={errorMessage(mgmt.error)} onRetry={() => mgmt.refetch()} />
        : (!isAdmin && d.classes.length === 0) ? <Gate title="No classes assigned" body="You are approved as a teacher but no class is assigned yet. Ask a school administrator to assign your classes." />
        : (
          <div className="portal-rise" key={section}>
            {isAdmin && d.classes.length === 0 && section !== "classes" && (
              <div className="portal-card mb-6 flex flex-col gap-4 border-l-4 border-l-[hsl(var(--p-gold))] p-5 sm:flex-row sm:items-center" data-testid="banner-first-class">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]"><School size={20} /></div>
                <div className="flex-1">
                  <p className="font-serif text-lg font-semibold">Start by creating your first class</p>
                  <p className="text-sm text-[hsl(var(--p-ink)/0.65)]">Exams, students, revision notes and announcements all belong to a class, so those buttons unlock once a class exists.</p>
                </div>
                <button className="portal-btn shrink-0" onClick={() => setSection("classes")} data-testid="button-go-classes">Create a class <ArrowRight size={15} /></button>
              </div>
            )}
            {section === "overview" && <Dashboard data={d} dark={theme.resolved === "dark"} onGo={setSection} />}
            {section === "exams" && <ExamsPanel data={d} isAdmin={isAdmin} />}
            {section === "marking" && <MarkingPanel data={d} />}
            {section === "reports" && <ReportsPanel />}
            {section === "revision" && <MaterialsPanel data={d} />}
            {section === "notices" && <NoticesPanel data={d} />}
            {isAdmin && section === "students" && <StudentsPanel data={d} />}
            {isAdmin && section === "teachers" && <TeachersPanel data={d} />}
            {isAdmin && section === "classes" && <ClassesPanel data={d} />}
          </div>
        )}
    </AppShell>
  );
}
