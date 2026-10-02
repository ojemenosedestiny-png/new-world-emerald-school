import type { ClassFeeSchedule } from "@workspace/api-client-react";

export function FeeScheduleOverview({
  schedules,
  formatAmount,
}: {
  schedules: ClassFeeSchedule[];
  formatAmount: (amount: number) => string;
}) {
  if (!schedules.length) return null;

  return (
    <section className="mb-10 rounded-2xl border border-border bg-card p-5 md:p-8" aria-labelledby="fee-overview-title" data-testid="panel-fee-overview">
      <h2 id="fee-overview-title" className="font-serif text-2xl font-bold">School fee prices</h2>
      <p className="mt-2 text-sm text-muted-foreground">View the amount for each class and term before completing a payment report.</p>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Published class and term fee schedules</caption>
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th scope="col" className="pb-3 pr-4 font-semibold">Class</th>
              <th scope="col" className="pb-3 pr-4 font-semibold">Term / year</th>
              <th scope="col" className="pb-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {schedules.map((schedule) => (
              <tr key={schedule.id}>
                <th scope="row" className="py-4 pr-4 font-medium">
                  {schedule.className}
                  {schedule.description.startsWith("DEMO:") && (
                    <span className="ml-2 inline-block rounded bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase text-secondary">Demo</span>
                  )}
                </th>
                <td className="py-4 pr-4 text-muted-foreground">
                  {schedule.term}<span className="block text-xs">{schedule.academicYear}</span>
                </td>
                <td className="py-4 text-right font-semibold tabular-nums text-primary">{formatAmount(schedule.amountKobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}