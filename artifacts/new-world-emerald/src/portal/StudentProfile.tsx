import type { PortalSession } from "@workspace/api-client-react";
import { BadgeCheck, GraduationCap, IdCard, KeyRound } from "lucide-react";
import { PasswordChange } from "./PasswordChange";

/** The student's own details and password; photo upload arrives with the profile phase. */
export function StudentProfile({ session, className }: { session: PortalSession; className: string }) {
  const initials = session.name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  const rows: [typeof IdCard, string, string][] = [
    [IdCard, "Student ID", session.studentId ?? ""],
    [GraduationCap, "Class", className || "-"],
    [BadgeCheck, "Account", "Active"],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 lg:px-0">
      <section className="portal-card overflow-hidden" data-testid="panel-profile">
        <div className="portal-hero flex items-center gap-4 px-6 py-6">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[hsl(41_72%_52%)] text-xl font-bold text-[hsl(205_40%_10%)] ring-4 ring-white/25" aria-hidden="true">{initials}</span>
          <div className="min-w-0"><p className="truncate font-serif text-2xl font-semibold">{session.name}</p><p className="text-sm text-white/75">New World Emerald student</p></div>
        </div>
        <dl className="divide-y divide-[hsl(var(--p-line))]">
          {rows.map(([Icon, label, value]) => (
            <div key={label} className="flex items-center gap-3 px-6 py-3.5">
              <Icon size={17} className="text-[hsl(var(--p-emerald))]" aria-hidden="true" />
              <dt className="w-28 text-sm text-[hsl(var(--p-ink)/0.6)]">{label}</dt>
              <dd className={"min-w-0 flex-1 truncate font-semibold " + (label === "Student ID" ? "font-mono" : "")}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-[hsl(var(--p-line))] px-6 py-3 text-xs text-[hsl(var(--p-ink)/0.55)]">To correct your name or class, contact the school office.</p>
      </section>
      <section className="portal-card p-6" aria-labelledby="pw-heading">
        <h2 id="pw-heading" className="mb-4 flex items-center gap-2 text-lg font-semibold"><KeyRound size={18} className="text-[hsl(var(--p-emerald))]" /> Change password</h2>
        <PasswordChange required={false} />
      </section>
    </div>
  );
}
