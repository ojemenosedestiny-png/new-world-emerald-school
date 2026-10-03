import { Link } from "wouter";
import { getListClassFeeSchedulesQueryKey, getListStoreProductsQueryKey, useListClassFeeSchedules, useListStoreProducts } from "@workspace/api-client-react";
import { asset } from "@/lib/asset";
import { AnimatedHeading } from "@/components/AnimatedHeading";
import { SchoolFeeGuide } from "@/components/SchoolFeeGuide";

const money = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
const queryOptions = { staleTime: 15_000, refetchInterval: 30_000, refetchOnMount: "always" as const };

/** Uses the same published records as the School Office's catalogue and fees tools. */
export function ParentCommercePreview() {
  const products = useListStoreProducts({ query: { ...queryOptions, queryKey: getListStoreProductsQueryKey() } });
  const schedules = useListClassFeeSchedules({ query: { ...queryOptions, queryKey: getListClassFeeSchedulesQueryKey() } });
  const catalogue = (products.data ?? []).filter((product) => product.isActive)
    .sort((a, b) => Number(b.category === "uniform") - Number(a.category === "uniform"));
  const fees = (schedules.data ?? []).filter((schedule) => schedule.isActive && !schedule.description.trimStart().toUpperCase().startsWith("DEMO:"));
  const productDemo = catalogue.some((product) => product.description.startsWith("DEMO:"));

  return (
    <div className="mt-5 grid items-start gap-5 lg:grid-cols-[0.85fr_1.15fr]" data-testid="parent-commerce-preview">
      <section aria-labelledby="fees-preview-title" className="min-w-0 rounded-2xl border border-primary/15 bg-background p-4 sm:p-5">
        <div className="mb-4">
          <AnimatedHeading as="h3" id="fees-preview-title" className="font-serif text-xl font-bold text-secondary">School fees</AnimatedHeading>
        </div>
        <SchoolFeeGuide />
        {schedules.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading fees…</p>
          : schedules.isError ? <p role="status" className="text-sm text-muted-foreground">Fees could not be loaded. Please contact the School Office.</p>
          : fees.length === 0 ? null
          : <ul className="mt-4 divide-y divide-border border-t pt-3" aria-label="Published class and term fees" data-testid="homepage-fee-schedules">
            {fees.map((fee) => (
              <li key={fee.id} className="flex items-start justify-between gap-3 py-3 first:pt-0" data-testid={`homepage-fee-${fee.id}`}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{fee.className} {fee.description.startsWith("DEMO:") && <span className="text-[10px] font-normal uppercase text-muted-foreground">· Demo</span>}</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{fee.term} · {fee.academicYear}</p>
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-primary">{money(fee.amountKobo)}</p>
              </li>
            ))}
          </ul>}
      </section>
      <section aria-labelledby="uniform-preview-title" className="min-w-0 rounded-2xl border border-primary/15 bg-background p-4 sm:p-5">
        <AnimatedHeading as="h3" id="uniform-preview-title" className="mb-4 font-serif text-xl font-bold text-secondary">Uniforms &amp; school store</AnimatedHeading>
        {products.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading store products…</p>
          : products.isError ? <p role="status" className="text-sm text-muted-foreground">Store products could not be loaded. Please contact the School Office.</p>
          : catalogue.length === 0 ? <p className="text-sm text-muted-foreground">Contact the School Office for product availability and prices.</p>
          : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="homepage-store-products">
            {catalogue.map((product) => (
              <Link key={product.id} href="/commerce?section=shop" aria-label={`${product.title}, ${money(product.priceKobo)}. View order details.`} className="min-w-0 rounded-xl border border-border p-3 transition-colors hover:border-primary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" data-testid={`homepage-uniform-${product.id}`}>
                {product.imageUrl ? <img
                  src={product.imageUrl.startsWith("/") ? asset(product.imageUrl) : product.imageUrl}
                  alt={product.title}
                  loading="lazy"
                  className="mb-2 h-28 w-full rounded-lg bg-muted/30 object-contain sm:h-36"
                /> : <div className="mb-2 flex h-28 items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground">School essential</div>}
                <p className="text-sm font-semibold leading-5">{product.title.replace(/^Demo — /, "")}</p>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">{product.variant}</p>
                <p className="mt-2 text-sm font-bold text-primary">{money(product.priceKobo)}</p>
                {product.description.startsWith("DEMO:") && <span className="mt-1 block text-[10px] font-semibold uppercase text-muted-foreground">Demo</span>}
              </Link>
            ))}
          </div>}
        {productDemo && <p className="mt-3 text-xs leading-5 text-muted-foreground">Demo illustrations and prices only. Confirm official products and prices with the School Office.</p>}
      </section>
    </div>
  );
}