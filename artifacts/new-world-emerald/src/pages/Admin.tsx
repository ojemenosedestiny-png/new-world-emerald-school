import { asset } from "@/lib/asset";
import React, { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  Clock3,
  ExternalLink,
  FileText,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  Mail,
  Palette,
  PenSquare,
  Phone,
  School,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import {
  ApiError,
  getListAdmissionApplicationsQueryKey,
  useListAdmissionApplications,
  useListAcademicCalendar,
  useUpdateAdmissionApplication,
  useGetWebsiteAdminAccess,
  getGetWebsiteAdminAccessQueryKey,
  useGetPortalManagement,
  getGetPortalManagementQueryKey,
  type AdmissionApplication,
} from "@workspace/api-client-react";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import "@/portal/portal.css";
import { LiveUpdatesManager } from "@/components/LiveUpdatesManager";
import { GraphicsStudio } from "@/components/GraphicsStudio";
import { SchoolCommerceManager } from "@/components/SchoolCommerceManager";
import { SiteContentManager } from "@/components/SiteContentManager";
import { AcademicCalendar } from "@/components/AcademicCalendar";
import { MediaStorageCard } from "@/components/MediaStorageCard";
import { EmailCard } from "@/components/EmailCard";
import { ADMISSION_DOCUMENTS } from "@/components/AdmissionRequirements";
import { AppShell, type NavGroup } from "@/portal/shell/AppShell";
import { usePortalTheme } from "@/portal/shell/theme";
import { trackEvent } from "@/lib/analytics";
import { TwoFactorSetup } from "@/components/TwoFactorSetup";
import { IdleSignOut } from "@/components/IdleSignOut";

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

export function greeting(hour = new Date().getHours()) {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

type Section = "dashboard" | "admissions" | "updates" | "content" | "calendar" | "store" | "graphics";
const TITLES: Record<Section, string> = {
  dashboard: "Dashboard", admissions: "Admission applications", updates: "Live school updates", content: "Website content",
  calendar: "Academic calendar", store: "School store and fees", graphics: "Graphics studio",
};

/** The documents the family ticked as ready on the application form, and what is still to come. */
function ApplicationDocuments({ ready, id }: { ready: string[]; id: number }) {
  const missing = ADMISSION_DOCUMENTS.filter((d) => !ready.includes(d.key));
  return (
    <details className="mt-3 text-sm" data-testid={`application-documents-${id}`}>
      <summary className="cursor-pointer font-semibold text-[hsl(var(--p-ink)/0.75)]">
        Documents: <span className={missing.length ? "text-[hsl(var(--p-gold-ink))]" : "text-[hsl(var(--p-emerald))]"}>{ready.length} of {ADMISSION_DOCUMENTS.length} ready</span>
      </summary>
      <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {ADMISSION_DOCUMENTS.map((d) => {
          const has = ready.includes(d.key);
          return (
            <li key={d.key} className={"flex items-center gap-2 " + (has ? "" : "text-[hsl(var(--p-ink)/0.55)]")}>
              <span aria-hidden="true" className={"grid h-4 w-4 place-items-center rounded-full text-[10px] font-bold " + (has ? "bg-[hsl(var(--p-emerald))] text-white" : "border border-[hsl(var(--p-line))]")}>{has ? "✓" : ""}</span>
              {d.title}<span className="sr-only">{has ? " (ready)" : " (still to bring)"}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ApplicationList({ applications, onStatus, limit }: { applications: AdmissionApplication[]; onStatus: (id: number, status: string) => void; limit?: number }) {
  return (
    <div className="divide-y divide-[hsl(var(--p-line))]">
      {applications.slice(0, limit).map((application) => (
        <article key={application.id} className="p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="flex min-w-0 gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[hsl(var(--p-emerald-soft))] font-bold text-[hsl(var(--p-emerald))]" aria-hidden="true">
                {(application.studentFirstName[0] ?? "") + (application.studentLastName[0] ?? "")}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-serif text-lg font-semibold">{application.studentFirstName} {application.studentLastName}</h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusClass(application.status)}`}>{statusLabel(application.status)}</span>
                </div>
                <p className="mt-0.5 text-sm text-[hsl(var(--p-ink)/0.6)]">{application.grade} · Entry {application.entryYear} · Submitted {formatDate(application.submittedAt)}</p>
                <div className="mt-2 flex flex-col gap-1.5 text-sm text-[hsl(var(--p-ink)/0.65)] sm:flex-row sm:gap-5">
                  <a href={`mailto:${application.guardianEmail}`} className="inline-flex min-w-0 items-center gap-2 hover:text-[hsl(var(--p-emerald))]"><Mail size={14} /> <span className="truncate">{application.guardianEmail}</span></a>
                  <a href={`tel:${application.guardianPhone}`} className="inline-flex items-center gap-2 hover:text-[hsl(var(--p-emerald))]"><Phone size={14} /> {application.guardianPhone}</a>
                </div>
                <ApplicationDocuments ready={application.documentsReady ?? []} id={application.id} />
              </div>
            </div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--p-ink)/0.55)]">
              Status
              <select value={application.status} onChange={(event) => onStatus(application.id, event.target.value)} className="portal-input mt-1.5 block !py-2 text-sm normal-case tracking-normal">
                {statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
              </select>
            </label>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function Admin() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const theme = usePortalTheme();
  const [section, setSection] = useState<Section>("dashboard");
  const isAuthenticated = isLoaded && isSignedIn === true;
  const isAuthLoading = !isLoaded;
  const login = () => setLocation("/sign-in");
  const logout = () => void signOut({ redirectUrl: import.meta.env.BASE_URL });
  const queryClient = useQueryClient();
  const accessQuery = useGetWebsiteAdminAccess({ query: { queryKey: [...getGetWebsiteAdminAccessQueryKey(), user?.externalId ?? user?.id ?? "anonymous"], enabled: isAuthenticated, retry: false } });
  const isAdmin = accessQuery.data?.isAdmin === true;
  const applicationsQuery = useListAdmissionApplications({
    query: {
      queryKey: getListAdmissionApplicationsQueryKey(),
      enabled: isAuthenticated && isAdmin,
    },
  });
  const portalQuery = useGetPortalManagement({ query: { queryKey: getGetPortalManagementQueryKey(), enabled: isAuthenticated && isAdmin, retry: false } });
  const calendarsQuery = useListAcademicCalendar();
  const updateApplication = useUpdateAdmissionApplication();

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
            <ShieldCheck size={18} /> Sign in with email
          </button>
          <Link href="/teacher" className="mt-4 block text-sm font-semibold text-accent underline" data-testid="link-teacher-signin">Teacher? Sign in to the teacher portal</Link>
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

  if (accessQuery.data?.mfaRequired) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-4">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 text-white">
          <ShieldCheck className="mx-auto mb-5 text-accent" size={36} />
          <h1 className="text-center font-serif text-3xl font-bold" data-testid="admin-access-status">Turn on two-factor</h1>
          <div className="mt-5"><TwoFactorSetup onCheckAgain={() => void accessQuery.refetch()} checking={accessQuery.isFetching} /></div>
          <button onClick={logout} className="mt-5 w-full text-sm text-white/60 hover:text-white">Sign out</button>
        </div>
      </main>
    );
  }

  const accessDenied = accessQuery.error instanceof ApiError && [401, 403].includes(accessQuery.error.status);
  const accessUnavailable = accessQuery.isError && !accessDenied;
  if (accessQuery.isError || !isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-4">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 text-center text-white">
          <ShieldCheck className="mx-auto mb-5 text-accent" size={36} />
          <h1 data-testid="admin-access-status" className="font-serif text-3xl font-bold">{accessUnavailable ? "Access check unavailable" : "Administrator access required"}</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">{accessUnavailable ? "We could not confirm your access. Please retry." : "Only accounts approved by the school can manage this website. Sign in with an approved administrator account."}</p>
          {accessUnavailable && <button onClick={() => accessQuery.refetch()} className="mt-6 rounded-xl bg-accent px-5 py-3 font-bold text-secondary">Retry access check</button>}
          {!accessUnavailable && <Link href="/portal/manage" className="mt-6 block rounded-xl bg-accent px-5 py-3 font-bold text-secondary" data-testid="link-teacher-workspace">I'm a teacher: open my classes</Link>}
          <Link href="/account" className="mt-6 block text-sm text-accent underline">View school account</Link>
          <button onClick={logout} className="mt-6 block w-full rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold">Sign out / use another account</button>
          <Link href="/" className="mt-5 inline-block text-sm text-white/70">Back to the school website</Link>
        </div>
      </main>
    );
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const groups: NavGroup<Section>[] = [
    { items: [{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "tab-admin-dashboard" }] },
    { label: "Families", items: [{ key: "admissions", label: "Admissions", icon: GraduationCap, badge: newApplications, testId: "tab-admin-admissions" }] },
    { label: "Website", items: [
      { key: "updates", label: "Live updates", icon: Clapperboard, testId: "tab-admin-updates" },
      { key: "content", label: "Website content", icon: PenSquare, testId: "tab-admin-content" },
      { key: "calendar", label: "Academic calendar", icon: CalendarDays, testId: "tab-admin-calendar" },
      { key: "graphics", label: "Graphics studio", icon: Palette, testId: "tab-admin-graphics" },
    ] },
    { label: "Business", items: [{ key: "store", label: "Store and fees", icon: Store, testId: "tab-admin-store" }] },
  ];
  const portal = portalQuery.data;
  const portalStats: [string, number][] = portal ? [
    ["Classes", portal.classes.length],
    ["Students", portal.students.filter((s) => s.active).length],
    ["Teachers", portal.teachers.filter((t) => t.active).length],
    ["Exams", portal.exams.length],
  ] : [];
  const quick: { label: string; detail: string; icon: typeof Store; go: Section; tile: string; testId?: string }[] = [
    { label: "Publish a video", detail: "Live school updates", icon: Clapperboard, go: "updates", tile: "330 65% 52%" },
    { label: "Edit website", detail: "Pages, news and photos", icon: PenSquare, go: "content", tile: "212 75% 48%" },
    { label: "School store", detail: "Orders and fee payments", icon: Store, go: "store", tile: "41 80% 42%", testId: "link-admin-school-store" },
    { label: "Upload calendar", detail: "Weekly calendar PDF", icon: CalendarDays, go: "calendar", tile: "152 55% 36%" },
    { label: "Graphics studio", detail: "Flyers and banners", icon: Palette, go: "graphics", tile: "262 55% 55%" },
    { label: "Admissions", detail: newApplications ? `${newApplications} waiting for you` : "Review families", icon: Users, go: "admissions", tile: "18 80% 50%" },
  ];
  const today = new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  const applicationsCard = (limit?: number) => (
    <section className="portal-card overflow-hidden">
      <div className="flex flex-col justify-between gap-3 border-b border-[hsl(var(--p-line))] p-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-serif text-2xl font-semibold">Admission applications</h2>
          <p className="mt-0.5 text-sm text-[hsl(var(--p-ink)/0.6)]">Follow up with families and track every application.</p>
        </div>
        {limit && applications.length > limit
          ? <button type="button" className="portal-btn-ghost w-fit" onClick={() => setSection("admissions")}>View all {applications.length} <ArrowRight size={14} /></button>
          : <span className="w-fit rounded-full bg-[hsl(var(--p-emerald-soft))] px-3 py-1 text-xs font-bold text-[hsl(var(--p-emerald))]">{applications.length} total</span>}
      </div>
      {applicationsQuery.isLoading ? (
        <div className="flex items-center gap-3 p-8 text-[hsl(var(--p-ink)/0.6)]"><Loader2 className="animate-spin" size={19} /> Loading applications…</div>
      ) : applicationsQuery.isError ? (
        <p className="p-8 text-sm text-[hsl(var(--p-red))]">Applications could not be loaded. Refresh and try again.</p>
      ) : applications.length === 0 ? (
        <div className="p-10 text-center">
          <GraduationCap className="mx-auto mb-4 text-[hsl(var(--p-ink)/0.4)]" size={34} />
          <h3 className="font-serif text-xl font-semibold">No applications yet</h3>
          <p className="mt-2 text-sm text-[hsl(var(--p-ink)/0.6)]">New submissions from the website will appear here.</p>
        </div>
      ) : <ApplicationList applications={applications} limit={limit} onStatus={(id, status) => void handleStatusChange(id, status)} />}
    </section>
  );

  return (
    <AppShell<Section>
      subtitle="School office"
      groups={groups} active={section} onNavigate={setSection}
      title={TITLES[section]} eyebrow="Website management"
      user={{ name: user?.firstName || "School office", detail: email || "Administrator" }}
      theme={theme.theme} onTheme={theme.setTheme}
      onSignOut={logout}
      actions={<>
        <Link href="/portal/manage" className="portal-btn !px-3 !py-2" data-testid="link-portal-manage"><BookOpenCheck size={16} /> <span className="sm:hidden">Portal</span><span className="hidden sm:inline">Learning portal</span></Link>
        {/* Wrapper carries the breakpoint: .portal-btn-ghost sets display and would override it. */}
        <div className="hidden sm:block"><a href={import.meta.env.BASE_URL} target="_blank" rel="noreferrer" className="portal-btn-ghost !px-2.5" aria-label="View the website"><ExternalLink size={16} /></a></div>
      </>}
      sidebarFooter={<>
        <Link href="/portal/manage" className="portal-nav-item" data-testid="link-sidebar-portal"><BookOpenCheck size={17} aria-hidden="true" /><span>Learning portal</span></Link>
        <a href={import.meta.env.BASE_URL} target="_blank" rel="noreferrer" className="portal-nav-item"><Globe size={17} aria-hidden="true" /><span>View website</span></a>
      </>}
    >
      <IdleSignOut enabled={isAdmin} onSignOut={logout} />
      <div className="portal-rise space-y-6" key={section}>
        {section === "dashboard" && <>
          <section className="portal-hero relative overflow-hidden rounded-[28px] px-6 py-7 md:px-8 md:py-9">
            <Sparkles className="absolute -right-4 -top-4 h-36 w-36 text-white/[0.06]" aria-hidden="true" />
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[hsl(41_80%_70%)]">{today}</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold md:text-[40px] md:leading-tight">{greeting()}, school office.</h2>
            <p className="mt-2 max-w-xl text-white/75">Review prospective families, keep the public website fresh and run the Learning portal from one place.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { icon: Users, value: applications.length, label: "Applications received", go: "admissions" as Section },
                { icon: Clock3, value: newApplications, label: "New, needs attention", go: "admissions" as Section },
                { icon: CalendarDays, value: calendarsQuery.data?.length ?? 0, label: "Calendar updates online", go: "calendar" as Section },
              ].map((k) => (
                <button key={k.label} type="button" onClick={() => setSection(k.go)} className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 text-left ring-1 ring-white/10 transition-colors hover:bg-white/15">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10"><k.icon size={19} /></span>
                  <span><span className="block text-2xl font-bold leading-none">{k.value}</span><span className="mt-1 block text-xs text-white/70">{k.label}</span></span>
                </button>
              ))}
            </div>
          </section>

          <section className="portal-card relative overflow-hidden border-l-4 border-l-[hsl(var(--p-gold))] p-6 md:p-7" data-testid="card-learning-portal">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 gap-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]"><School size={26} /></span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--p-gold-ink))]">Learning portal</p>
                  <h2 className="font-serif text-2xl font-semibold">Exams, results and student life</h2>
                  <p className="mt-1 text-sm text-[hsl(var(--p-ink)/0.65)]">Students, teachers, CBT exams, report cards, events, gallery and photo approvals.</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link href="/portal/manage" className="portal-btn justify-center" data-testid="button-open-learning-portal">Open Learning portal <ArrowRight size={15} /></Link>
                <Link href="/portal" className="portal-btn-ghost justify-center">Student login page</Link>
              </div>
            </div>
            {portalStats.length > 0 && (
              <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-[hsl(var(--p-line))] pt-5 sm:grid-cols-4" data-testid="portal-stats">
                {portalStats.map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-[hsl(var(--p-paper-2)/0.6)] px-4 py-3">
                    <dt className="text-xs font-semibold text-[hsl(var(--p-ink)/0.6)]">{label}</dt>
                    <dd className="text-2xl font-bold">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section aria-label="Quick actions">
            <h2 className="mb-3 text-lg font-semibold">Quick actions</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {quick.map((q) => (
                <button key={q.label} type="button" onClick={() => setSection(q.go)} className="portal-tile !min-h-[118px]" style={{ "--tile": q.tile } as React.CSSProperties} data-testid={q.testId}>
                  <span className="portal-tile-icon"><q.icon size={19} aria-hidden="true" /></span>
                  <span className="mt-auto flex items-end justify-between gap-2">
                    <span className="min-w-0"><span className="block font-semibold">{q.label}</span><span className="block truncate text-xs text-[hsl(var(--p-ink)/0.6)]">{q.detail}</span></span>
                    <ChevronRight size={16} className="shrink-0 opacity-50" />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
            {applicationsCard(4)}
            <div className="space-y-6">
            <section className="portal-card p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div><h2 className="font-serif text-xl font-semibold">Academic calendar</h2><p className="mt-0.5 text-sm text-[hsl(var(--p-ink)/0.6)]">What families see this week.</p></div>
                <CalendarDays className="text-[hsl(var(--p-emerald))]" size={21} />
              </div>
              <div className="space-y-2">
                {(calendarsQuery.data ?? []).slice(0, 4).map((calendar) => (
                  <a key={calendar.id} href={`/api/storage${calendar.objectPath}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-[hsl(var(--p-line))] p-3 transition-colors hover:border-[hsl(var(--p-emerald)/0.4)]">
                    <FileText className="shrink-0 text-[hsl(var(--p-emerald))]" size={17} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{calendar.title}</span>
                    <ExternalLink className="shrink-0 opacity-50" size={14} />
                  </a>
                ))}
                {(calendarsQuery.data ?? []).length === 0 && <p className="rounded-xl bg-[hsl(var(--p-paper-2)/0.6)] p-4 text-sm text-[hsl(var(--p-ink)/0.6)]">No weekly calendars published yet.</p>}
              </div>
              <button type="button" onClick={() => setSection("calendar")} data-testid="button-office-calendar-manager" className="portal-btn mt-4 w-full justify-center"><CalendarDays size={16} /> Open calendar uploader</button>
            </section>
            <MediaStorageCard />
            <EmailCard />
            </div>
          </div>
        </>}
        {section === "admissions" && applicationsCard()}
        {section === "updates" && <LiveUpdatesManager />}
        {section === "content" && <SiteContentManager />}
        {section === "calendar" && <div className="portal-card p-5 md:p-6"><AcademicCalendar officeMode /></div>}
        {section === "store" && <div id="school-store"><SchoolCommerceManager /></div>}
        {section === "graphics" && <GraphicsStudio />}
      </div>
    </AppShell>
  );
}
