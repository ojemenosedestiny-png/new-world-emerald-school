import type { ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { useGetPortalSession, getGetPortalSessionQueryKey, useGetPortalManagement, getGetPortalManagementQueryKey } from "@workspace/api-client-react";
import { LogOut, ShieldAlert } from "lucide-react";
import "@/portal/portal.css";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackToWebsite, ErrorPanel, PortalHeader, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { ExamsPanel } from "@/portal/manage/ExamsPanel";
import { MarkingPanel } from "@/portal/manage/MarkingPanel";
import { MaterialsPanel, NoticesPanel } from "@/portal/manage/ContentPanels";
import { ClassesPanel, StudentsPanel, TeachersPanel } from "@/portal/manage/PeoplePanels";
import { ManageOverview } from "@/portal/manage/Overview";

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

export default function PortalManage() {
  usePortalMeta("Portal Management");
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
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

  return (
    <div className="portal">
      <PortalHeader subtitle={isAdmin ? "Portal administration" : "Teacher workspace"}>
        <span className="hidden text-sm opacity-70 sm:inline">{session.data?.name}</span>
        {isAdmin && <Link href="/admin" className="portal-btn-dark" data-testid="link-admin">Website admin</Link>}
        <button className="portal-btn-dark" onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })} aria-label="Sign out" data-testid="button-staff-logout"><LogOut size={14} /></button>
      </PortalHeader>
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <div className="portal-rise mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[hsl(var(--p-emerald))]">{isAdmin ? "All classes" : (d?.classes.length ?? 0) + " assigned classes"}</p>
          <h1 className="mt-1 font-serif text-4xl font-semibold">Learning portal</h1>
        </div>
        {mgmt.isLoading ? <div className="space-y-3"><Skeleton className="h-11 w-96" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
          : mgmt.isError || !d ? <ErrorPanel title="Management data did not load" message={errorMessage(mgmt.error)} onRetry={() => mgmt.refetch()} />
          : (!isAdmin && d.classes.length === 0) ? <Gate title="No classes assigned" body="You are approved as a teacher but no class is assigned yet. Ask a school administrator to assign your classes." />
          : (
            <>
            <ManageOverview data={d} />
            <Tabs defaultValue="exams">
              <TabsList className="mb-6 flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-full border border-[hsl(var(--p-line))] bg-white/70 p-1">
                <TabsTrigger value="exams" className="portal-tab" data-testid="tab-manage-exams">Exams</TabsTrigger>
                <TabsTrigger value="marking" className="portal-tab" data-testid="tab-manage-marking">Marking{toMark ? " (" + toMark + ")" : ""}</TabsTrigger>
                <TabsTrigger value="revision" className="portal-tab" data-testid="tab-manage-revision">Revision</TabsTrigger>
                <TabsTrigger value="notices" className="portal-tab" data-testid="tab-manage-notices">Announcements</TabsTrigger>
                {isAdmin && <TabsTrigger value="students" className="portal-tab" data-testid="tab-manage-students">Students</TabsTrigger>}
                {isAdmin && <TabsTrigger value="teachers" className="portal-tab" data-testid="tab-manage-teachers">Teachers</TabsTrigger>}
                {isAdmin && <TabsTrigger value="classes" className="portal-tab" data-testid="tab-manage-classes">Classes</TabsTrigger>}
              </TabsList>
              <TabsContent value="exams"><ExamsPanel data={d} isAdmin={isAdmin} /></TabsContent>
              <TabsContent value="marking"><MarkingPanel data={d} /></TabsContent>
              <TabsContent value="revision"><MaterialsPanel data={d} /></TabsContent>
              <TabsContent value="notices"><NoticesPanel data={d} /></TabsContent>
              {isAdmin && <TabsContent value="students"><StudentsPanel data={d} /></TabsContent>}
              {isAdmin && <TabsContent value="teachers"><TeachersPanel data={d} /></TabsContent>}
              {isAdmin && <TabsContent value="classes"><ClassesPanel data={d} /></TabsContent>}
            </Tabs>
            </>
          )}
      </main>
    </div>
  );
}
