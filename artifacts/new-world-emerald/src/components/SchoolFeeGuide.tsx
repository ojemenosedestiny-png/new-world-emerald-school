import { isSchoolSectionVisible } from "@/lib/siteContent";

/** Informational estimates, deliberately separate from payable fee schedules. */
export function SchoolFeeGuide() {
  const reportedFees = [
  {
    id: "day",
    title: "Day student tuition",
    val: "₦1,250,000",
    subtitle: "Approximate starting fee · annually",
  },
  {
    id: "boarding",
    title: "Boarding",
    val: "Up to ₦2,000,000",
    subtitle: "Reported estimate · annually",
  },
  {
    id: "registration",
    title: "Registration & assessment",
    val: "₦20,000",
    subtitle: "Reported one-time, non-refundable fee",
  },
  ];
  if (!isSchoolSectionVisible("SchoolFeeGuide")) return null;

  return (
    <div data-testid="reported-school-fee-guide">
      <p className="mb-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs leading-5 text-secondary">
        Indicative fee guide — reported estimates, not a confirmed school fee schedule.
      </p>
      <dl className="divide-y divide-border">
        {reportedFees.map((fee) => (
          <div key={fee.id} className="flex items-start justify-between gap-3 py-3" data-testid={`reported-fee-${fee.id}`}>
            <dt className="min-w-0">
              <span className="block text-sm font-semibold">{fee.title}</span>
              <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{fee.subtitle}</span>
            </dt>
            <dd className="shrink-0 text-sm font-bold tabular-nums text-primary">{fee.val}</dd>
          </div>
        ))}
      </dl>
      <details className="mt-3 rounded-lg border border-border px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-secondary">Inclusions and family discounts</summary>
        <p className="mt-2">
          The supplied overview reports feeding, uniforms, house wear and textbooks within day tuition. Confirm the actual package and boarding availability with the School Office.
        </p>
        <p className="mt-2">
          Ask about family discounts for the third and subsequent children. Discount amounts and eligibility must be confirmed by the School Office.
        </p>
      </details>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Confirm current fees for Early Years, Primary or Secondary before paying. These estimates are not invoices or amounts to pay through a fee report.
      </p>
      <a href="tel:+2348136037074" className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-4">
        Contact School Office: +234 813 603 7074
      </a>
    </div>
  );
}