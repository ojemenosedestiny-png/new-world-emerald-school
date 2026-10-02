import { asset } from "@/lib/asset";
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  GraduationCap,
  Loader2,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  getListAdmissionApplicationsQueryKey,
  useListAdmissionApplications,
  useListAcademicCalendar,
  useUpdateAdmissionApplication,
  useGetWebsiteAdminAccess,
  getGetWebsiteAdminAccessQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { LiveUpdatesManager } from "@/components/LiveUpdatesManager";
import { GraphicsStudio } from "@/components/GraphicsStudio";
import { SchoolCommerceManager } from "@/components/SchoolCommerceManager";
import { SiteContentManager } from "@/components/SiteContentManager";
import { AcademicCalendar } from "@/components/AcademicCalendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trackEvent } from "@/lib/analytics";

const statuses = ["new", "contacted", "invited", "accepted", "declined"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: string) {
  if (status === "accepted") return "bg-emerald-100 text-emerald-700";
  if (status === "declined") return "bg-red-100 text-red-700";
  if (status === "contacted" || status === "invited") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

export default function Admin() {
  const { isAuthenticated, isLoading: isAuthLoading, login, logout, user } = useAuth();
  const queryClient = useQueryClient();
  const accessQuery = useGetWebsiteAdminAccess({ query: { queryKey: [...getGetWebsiteAdminAccessQueryKey(), user?.id ?? "anonymous"], enabled: isAuthenticated, retry: false } });
  const isAdmin = accessQuery.data?.isAdmin === true;
  const applicationsQuery = useListAdmissionApplications({
    query: {
      queryKey: getListAdmissionApplicationsQueryKey(),
      enabled: isAuthenticated && isAdmin,
    },
  });
  const calendarsQuery = useListAcademicCalendar();
  const updateApplication = useUpdateAdmissionApplication();
  const [calendarManagerOpen, setCalendarManagerOpen] = useState(false);

  const applications = applicationsQuery.data ?? [];
  const newApplications = useMemo(
    () => applications.filter((application) => application.status === "new").length,
    [applications],
  );

  if (isAuthLoading || (isAuthenticated && accessQuery.isPending)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary text-white">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-4">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 text-center text-white shadow-2xl backdrop-blur">
          <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="mx-auto mb-6 h-20 w-20 object-contain" />
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.25em] text-accent">School office</p>
          <h1 className="font-serif text-3xl font-bold">Admin panel</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/65">
            Sign in to review admission applications and manage weekly school updates.
          </p>
          <button onClick={login} className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3.5 font-bold text-secondary transition-colors hover:bg-accent/90">
            <ShieldCheck size={18} /> Sign in to continue
          </button>
          <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
            <ArrowLeft size={15} /> Return to website
          </Link>
        </div>
      </main>
    );
  }

  const handleStatusChange = async (id: number, status: string) => {
    await updateApplication.mutateAsync({ id, data: { status } });
    trackEvent("admission_application_status_updated", { status });
    await queryClient.invalidateQueries({ queryKey: getListAdmissionApplicationsQueryKey() });
  };

  if (accessQuery.isError || !isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-4">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 text-center text-white">
          <ShieldCheck className="mx-auto mb-5 text-accent" size={36} />
          <h1 className="font-serif text-3xl font-bold">{accessQuery.isError ? "Access check unavailable" : "Administrator access required"}</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">{accessQuery.isError ? "We could not confirm your access. Please retry." : "Only accounts approved by the school can manage this website. Sign in with an approved administrator account."}</p>
          {accessQuery.isError && <button onClick={() => accessQuery.refetch()} className="mt-6 rounded-xl bg-accent px-5 py-3 font-bold text-secondary">Retry access check</button>}
          <button onClick={logout} className="mt-6 block w-full rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold">Sign out / use another account</button>
          <Link href="/" className="mt-5 inline-block text-sm text-white/70">Back to the school website</Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40 text-foreground">
      <header className="border-b border-border bg-secondary text-white">
        <div className="container mx-auto flex items-center justify-between gap-5 px-4 py-5 md:px-8">
          <Link href="/" className="flex items-center gap-3">
            <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="h-11 w-11 object-contain" />
            <div>
              <p className="font-serif text-lg font-bold">New World Emerald</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">School office</p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-white/60 sm:block">{user?.email}</span>
            <Link href="/" className="rounded-full border border-white/20 p-2.5 text-white/70 transition-colors hover:border-accent hover:text-accent" aria-label="Back to website">
              <ExternalLink size={17} />
            </Link>
            <button onClick={logout} className="rounded-full border border-white/20 p-2.5 text-white/70 transition-colors hover:border-accent hover:text-accent" aria-label="Log out">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 md:px-8">
        <div className="mb-10">
          <p className="mb-2 text-sm font-bold uppercase tracking-[0.22em] text-primary">Website management</p>
          <h1 className="font-serif text-4xl font-bold text-foreground md:text-5xl">Good morning, school office.</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Review prospective families and keep the public website current from one place.
          </p>
        </div>

        <div className="mb-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between text-primary"><Users size={21} /><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">All applications</span></div>
            <p className="text-3xl font-bold">{applications.length}</p>
            <p className="mt-1 text-sm text-muted-foreground">Submissions received</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between text-accent"><Clock3 size={21} /><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Needs attention</span></div>
            <p className="text-3xl font-bold">{newApplications}</p>
            <p className="mt-1 text-sm text-muted-foreground">New applications</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between text-primary"><CalendarDays size={21} /><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Published</span></div>
            <p className="text-3xl font-bold">{calendarsQuery.data?.length ?? 0}</p>
            <p className="mt-1 text-sm text-muted-foreground">Calendar updates online</p>
          </div>
        </div>

        <div className="mb-8">
          <LiveUpdatesManager />
        </div>

         <div className="mb-8">
           <SiteContentManager />
         </div>

         <div className="mb-8">
           <SchoolCommerceManager />
         </div>

        <div className="mb-8">
          <GraphicsStudio />
        </div>

        <div className="grid gap-8 xl:grid-cols-[1.3fr_0.7fr]">
          <section className="rounded-3xl border border-border bg-card shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-border p-6 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-serif text-2xl font-bold">Admission applications</h2>
                <p className="mt-1 text-sm text-muted-foreground">Follow up with families and track every application.</p>
              </div>
              <span className="w-fit rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">{applications.length} total</span>
            </div>
            {applicationsQuery.isLoading ? (
              <div className="flex items-center gap-3 p-8 text-muted-foreground"><Loader2 className="animate-spin" size={19} /> Loading applications…</div>
            ) : applicationsQuery.isError ? (
              <p className="p-8 text-sm text-destructive">Applications could not be loaded. Refresh and try again.</p>
            ) : applications.length === 0 ? (
              <div className="p-10 text-center">
                <GraduationCap className="mx-auto mb-4 text-muted-foreground" size={34} />
                <h3 className="font-serif text-xl font-bold">No applications yet</h3>
                <p className="mt-2 text-sm text-muted-foreground">New submissions from the website will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {applications.map((application) => (
                  <article key={application.id} className="p-6">
                    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-serif text-xl font-bold">{application.studentFirstName} {application.studentLastName}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusClass(application.status)}`}>{statusLabel(application.status)}</span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{application.grade} · Entry {application.entryYear} · Submitted {formatDate(application.submittedAt)}</p>
                        <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:gap-5">
                          <a href={`mailto:${application.guardianEmail}`} className="inline-flex items-center gap-2 hover:text-primary"><Mail size={15} /> {application.guardianEmail}</a>
                          <a href={`tel:${application.guardianPhone}`} className="inline-flex items-center gap-2 hover:text-primary"><Phone size={15} /> {application.guardianPhone}</a>
                        </div>
                      </div>
                      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Update status
                        <select value={application.status} onChange={(event) => void handleStatusChange(application.id, event.target.value)} className="mt-2 block rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:ring-2 focus:ring-primary/30">
                          {statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                        </select>
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-8">
            <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-serif text-2xl font-bold">Academic calendar</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Manage what families see on the website.</p>
                </div>
                <CalendarDays className="text-primary" size={23} />
              </div>
              <div className="space-y-3">
                {(calendarsQuery.data ?? []).slice(0, 4).map((calendar) => (
                  <a key={calendar.id} href={`/api/storage${calendar.objectPath}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-primary/40 hover:bg-primary/5">
                    <FileText className="shrink-0 text-primary" size={18} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{calendar.title}</span>
                    <ExternalLink className="shrink-0 text-muted-foreground" size={15} />
                  </a>
                ))}
                {(calendarsQuery.data ?? []).length === 0 && <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">No weekly calendars published yet.</p>}
              </div>
              <button type="button" onClick={() => setCalendarManagerOpen(true)} data-testid="button-office-calendar-manager" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90">
                <CalendarDays size={17} /> Open calendar uploader
              </button>
            </section>

            <section className="rounded-3xl bg-primary p-6 text-primary-foreground">
              <CheckCircle2 className="mb-5 text-accent" size={24} />
              <h2 className="font-serif text-2xl font-bold">Website is live</h2>
              <p className="mt-2 text-sm leading-relaxed text-primary-foreground/75">
                Calendar updates and admission submissions are connected to the public website in real time.
              </p>
              <Link href="/" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-accent hover:text-white">
                Preview website <ExternalLink size={15} />
              </Link>
            </section>
          </aside>
        </div>
      </main>
      <Dialog open={calendarManagerOpen} onOpenChange={setCalendarManagerOpen}>
        <DialogContent className="max-w-5xl" data-testid="dialog-office-calendar-manager">
          <DialogHeader>
            <DialogTitle>Manage academic calendars</DialogTitle>
            <DialogDescription>Publish weekly updates for families from the School Office area.</DialogDescription>
          </DialogHeader>
          <AcademicCalendar officeMode />
        </DialogContent>
      </Dialog>
    </div>
  );
}