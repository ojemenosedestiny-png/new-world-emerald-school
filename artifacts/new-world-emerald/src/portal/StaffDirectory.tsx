import { useState } from "react";
import { useGetStaffDirectory, getGetStaffDirectoryQueryKey } from "@workspace/api-client-react";
import { Search, Users } from "lucide-react";
import { EmptyState, ErrorPanel, Skeleton } from "./ui";
import { errorMessage } from "./lib";

const HUES = ["152 55% 36%", "41 80% 42%", "212 75% 48%", "330 65% 52%", "262 55% 55%", "183 60% 34%"];

/** Names, roles, subjects and classes of the school's staff. No contact details by design. */
export function StaffDirectory() {
  const staff = useGetStaffDirectory({ query: { queryKey: getGetStaffDirectoryQueryKey() } });
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = (staff.data ?? []).filter((t) => !q || [t.name, t.title, ...t.subjects, ...t.classNames].some((v) => v.toLowerCase().includes(q)));

  if (staff.isError) return <div className="px-4 lg:px-0"><ErrorPanel title="The staff list could not load" message={errorMessage(staff.error)} onRetry={() => staff.refetch()} /></div>;
  return (
    <div className="space-y-4 px-4 lg:px-0">
      <label className="relative block max-w-md">
        <span className="sr-only">Search staff</span>
        <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--p-emerald))]" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, subject or class" className="portal-input !rounded-2xl" style={{ paddingLeft: "2.75rem" }} data-testid="input-staff-search" />
      </label>
      {staff.isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
        : (staff.data ?? []).length === 0 ? <EmptyState icon={<Users size={22} />} title="No staff listed yet" body="The school office adds teachers to the directory." />
        : rows.length === 0 ? <p className="portal-card px-4 py-6 text-center text-sm text-[hsl(var(--p-ink)/0.6)]">No one matches "{query.trim()}".</p>
        : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="list-staff">
            {rows.map((t) => {
              const hue = HUES[t.id % HUES.length];
              const initials = t.name.replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
              return (
                <li key={t.id} className="portal-card flex gap-4 p-4" data-testid={"staff-" + t.id}>
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-bold text-white" style={{ background: `hsl(${hue})` }} aria-hidden="true">{initials || "?"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{t.name}</p>
                    <p className="truncate text-sm text-[hsl(var(--p-ink)/0.62)]">{t.title || "Teacher"}</p>
                    {t.subjects.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{t.subjects.map((s) => <span key={s} className="rounded-full bg-[hsl(var(--p-emerald-soft))] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--p-emerald))]">{s}</span>)}</div>}
                    {t.classNames.length > 0 && <p className="mt-1.5 truncate text-xs text-[hsl(var(--p-ink)/0.55)]">Classes: {t.classNames.join(", ")}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
