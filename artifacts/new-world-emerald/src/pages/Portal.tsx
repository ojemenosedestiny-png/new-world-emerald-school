import { Link } from "wouter";
import { useGetPortalSession, getGetPortalSessionQueryKey } from "@workspace/api-client-react";
import { ShieldCheck } from "lucide-react";
import "@/portal/portal.css";
import { StudentLogin } from "@/portal/StudentLogin";
import { StudentDashboard, useStudentLogout } from "@/portal/StudentDashboard";
import { PasswordChange } from "@/portal/PasswordChange";
import { BackToWebsite, ErrorPanel, PortalHeader, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";

function RequiredPassword() {
  const logout = useStudentLogout();
  return (
    <div className="portal">
      <PortalHeader subtitle="Student Portal">
        <button className="portal-btn-dark" onClick={logout.run} disabled={logout.pending} data-testid="button-student-logout">Sign out</button>
      </PortalHeader>
      <main className="mx-auto max-w-md px-4 py-12 portal-rise">
        <h1 className="mb-6 font-serif text-3xl font-semibold">Set your password</h1>
        <div className="portal-card p-6"><PasswordChange required /></div>
      </main>
    </div>
  );
}

export default function Portal() {
  usePortalMeta("Student Portal");
  const session = useGetPortalSession({ query: { queryKey: getGetPortalSessionQueryKey(), retry: 1 } });

  if (session.isLoading) {
    return <div className="portal p-8"><div className="mx-auto max-w-md space-y-4 pt-24"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div></div>;
  }
  if (session.isError || !session.data) {
    return (
      <div className="portal grid place-items-center px-4">
        <div className="w-full max-w-md space-y-4"><ErrorPanel title="The portal is unreachable" message={errorMessage(session.error)} onRetry={() => session.refetch()} /><BackToWebsite /></div>
      </div>
    );
  }
  const s = session.data;
  if (s.role === "student") return s.mustChangePassword ? <RequiredPassword /> : <StudentDashboard session={s} />;
  if (s.role === "teacher" || s.role === "admin") {
    return (
      <div className="portal grid place-items-center px-4">
        <div className="portal-card portal-rise max-w-md p-8 text-center">
          <ShieldCheck className="mx-auto text-[hsl(var(--p-emerald))]" size={34} />
          <h1 className="mt-4 font-serif text-3xl font-semibold">Signed in as staff</h1>
          <p className="mt-2 text-sm text-[hsl(var(--p-ink)/0.65)]">{s.name}, your exams, revision and marking tools are in staff management.</p>
          <Link href="/portal/manage" className="portal-btn mt-6 w-full" data-testid="link-go-manage">Open staff management</Link>
          <div className="mt-5"><BackToWebsite /></div>
        </div>
      </div>
    );
  }
  return <StudentLogin />;
}
