import { AnimatedHeading } from "@/components/AnimatedHeading";
import { ArrowUpRight, Shirt, Wallet } from 'lucide-react';
import { Link } from 'wouter';

export function ParentServices() {
  return (
    <section id="parent-services"
      aria-labelledby="parent-services-title"
      className="relative overflow-hidden border-y border-primary/10 bg-[#f5f3e9] py-6 md:py-12"
      data-testid="section-parent-services"
    >
      <div className="container mx-auto px-4 md:px-8">
          <div className="max-w-md">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              For parents
            </p>
            <AnimatedHeading as="h2" id="parent-services-title" className="font-serif text-2xl font-bold leading-tight text-secondary md:text-[2.1rem]">
              Parent resources, <span className="text-primary">in one place.</span>
            </AnimatedHeading>
          </div>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Pay school fees online for all your children in one place, with Paystack, and get a receipt straight away. Uniforms and fee guidance are on the Uniforms &amp; School Payments page.
        </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/parents"
              data-testid="link-home-parent-portal"
              className="group inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary motion-reduce:transition-none"
            >
              <Wallet aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>Parent portal: pay school fees</span>
              <ArrowUpRight aria-hidden="true" size={14} />
            </Link>
            <Link
              href="/commerce?section=fees"
              data-testid="link-home-parent-services"
              className="group inline-flex items-center gap-2 rounded-xl border border-primary/15 bg-background/75 px-4 py-3 text-sm font-semibold text-secondary transition-colors hover:border-primary/40 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary motion-reduce:transition-none"
            >
              <Shirt aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>Uniforms &amp; School Payments</span>
              <ArrowUpRight aria-hidden="true" size={14} className="text-primary" />
            </Link>
          </div>
      </div>
    </section>
  );
}