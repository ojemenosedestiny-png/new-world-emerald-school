import type { FeeStatement as Statement } from "@workspace/api-client-react";
import { useGetMyFees, getGetMyFeesQueryKey, useGetStudentFees, getGetStudentFeesQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Wallet } from "lucide-react";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "./ui";
import { errorMessage, formatDateTime } from "./lib";

export const naira = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(kobo / 100);

const PAYMENT_STATUS: Record<string, { label: string; tone: "green" | "gold" | "red" | "muted" }> = {
  confirmed: { label: "Confirmed", tone: "green" },
  reported: { label: "Being checked", tone: "gold" },
  payment_requested: { label: "Awaiting transfer", tone: "muted" },
  rejected: { label: "Not confirmed", tone: "red" },
};

/** Fees, payments and the balance for one student. `forOffice` hides the pay-now link. */
export function FeeStatementView({ s, forOffice = false }: { s: Statement; forOffice?: boolean }) {
  if (!s.items.length && !s.payments.length) {
    return <EmptyState icon={<Wallet size={22} />} title="No fees listed yet" body={forOffice ? `No class fee is set for ${s.className || "this class"} and there are no charges for this student ID.` : "When the school office sets the fees for your class, they appear here."} />;
  }
  const t = s.totals;
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Fee totals" data-testid="panel-fee-totals">
        {[["Total fees", t.totalKobo, ""], ["Paid", t.paidKobo, "152 55% 36%"], ["Being checked", t.pendingKobo, "41 80% 42%"], ["Balance", t.outstandingKobo, t.outstandingKobo > 0 ? "4 66% 46%" : "152 55% 36%"]].map(([label, kobo, hue]) => (
          <div key={label as string} className="portal-card p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[hsl(var(--p-ink)/0.55)]">{label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums" style={hue ? { color: `hsl(${hue})` } : undefined} data-testid={`fee-total-${(label as string).toLowerCase().replace(/ /g, "-")}`}>{naira(kobo as number)}</p>
          </div>
        ))}
      </section>
      {s.items.length > 0 && (
        <ul className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden" data-testid="list-fee-items">
          {s.items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center gap-3 p-4" data-testid={`fee-item-${i.key}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{i.description}</p>
                <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{i.term} / {i.academicYear}{i.kind === "individual" ? " / Individual charge" : " / Class fee"}{i.reference ? <> / Ref <span className="font-mono">{i.reference}</span></> : null}</p>
              </div>
              <p className="font-bold tabular-nums">{naira(i.amountKobo)}</p>
              {i.status === "paid" ? <StatusPill tone="green">Paid</StatusPill> : i.status === "pending" ? <StatusPill tone="gold">Being checked</StatusPill> : <StatusPill tone="red">Due</StatusPill>}
            </li>
          ))}
        </ul>
      )}
      {!forOffice && t.outstandingKobo > 0 && (
        <div className="portal-card flex flex-wrap items-center gap-3 p-4">
          <p className="min-w-0 flex-1 text-sm">Pay by bank transfer on the School Payments page. Use your student ID <span className="font-mono font-semibold">{s.studentId}</span>{s.items.some((i) => i.reference && i.status === "due") ? " and the charge reference shown above" : ""}, and add a screenshot of the transfer.</p>
          <Link href="/commerce" className="portal-btn" data-testid="link-pay-fees"><Wallet size={15} /> Pay school fees</Link>
        </div>
      )}
      {s.payments.length > 0 && (
        <section aria-label="Payments">
          <h3 className="mb-2 text-base font-semibold">Payments</h3>
          <ul className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden" data-testid="list-fee-payments">
            {s.payments.map((p) => {
              const st = PAYMENT_STATUS[p.status] ?? { label: p.status, tone: "muted" as const };
              return (
                <li key={p.reference} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1"><p className="font-mono text-sm font-semibold">{p.reference}</p><p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{formatDateTime(p.createdAt)}{p.description ? ` / ${p.description}` : ""}</p></div>
                  <p className="font-bold tabular-nums">{naira(p.amountKobo)}</p>
                  <StatusPill tone={st.tone}>{st.label}</StatusPill>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

export function StudentFees() {
  const q = useGetMyFees({ query: { queryKey: getGetMyFeesQueryKey() } });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <ErrorPanel title="Fees could not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <FeeStatementView s={q.data} />;
}

export function OfficeFeeStatement({ studentId }: { studentId: number }) {
  const q = useGetStudentFees(studentId, { query: { queryKey: getGetStudentFeesQueryKey(studentId) } });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data) return <ErrorPanel title="Statement could not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <FeeStatementView s={q.data} forOffice />;
}
