import { AnimatedHeading } from "@/components/AnimatedHeading";
import { ArrowUpRight, BookOpenCheck, Shirt } from 'lucide-react';
import { Link } from 'wouter';

const services = [
  {
    title: 'School fees',
    description: 'View fee information and submit a payment report for the School Office to verify.',
    href: '/commerce?section=fees',
    icon: BookOpenCheck,
    testId: 'link-parent-school-fees',
  },
  {
    title: 'Uniforms & materials',
    description: 'Browse school essentials and send an order request to the school.',
    href: '/commerce?section=shop',
    icon: Shirt,
    testId: 'link-parent-uniforms-materials',
  },
];

export function ParentServices() {
  return (
    <section
      aria-labelledby="parent-services-title"
      className="relative overflow-hidden border-y border-primary/10 bg-[#f5f3e9] py-12 md:py-14"
      data-testid="section-parent-services"
    >
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid gap-7 md:grid-cols-[0.82fr_1.18fr] md:items-center md:gap-12">
          <div className="max-w-md">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              For parents
            </p>
            <AnimatedHeading as="h2" id="parent-services-title" className="font-serif text-3xl font-bold leading-tight text-secondary md:text-[2.1rem]">
              School essentials, <span className="text-primary">in one place.</span>
            </AnimatedHeading>
            <p className="mt-3 max-w-sm text-sm leading-6 text-foreground/70">
              Find fee information or request uniforms and learning materials through the school office.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {services.map(({ title, description, href, icon: Icon, testId }, index) => (
              <Link
                key={title}
                href={href}
                data-testid={testId}
                className="group relative flex min-h-[148px] flex-col rounded-2xl border border-primary/15 bg-background/75 p-5 transition-colors hover:border-primary/40 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary motion-reduce:transition-none"
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/8 text-primary">
                    <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.16em] text-secondary/40">
                    0{index + 1}
                  </span>
                </div>
                <div className="flex items-center gap-2 font-serif text-lg font-bold text-secondary">
                  <AnimatedHeading as="h3">{title}</AnimatedHeading>
                  <ArrowUpRight aria-hidden="true" size={16} className="text-primary transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none" />
                </div>
                <span className="mt-1.5 text-xs leading-5 text-muted-foreground">{description}</span>
              </Link>
            ))}
          </div>
        </div>

        <p className="mt-6 flex items-start gap-2 border-t border-primary/10 pt-4 text-xs leading-5 text-muted-foreground md:ml-[calc(41%+1.5rem)]">
          <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          Payments are made externally, not processed on this website. The School Office verifies payment reports.
        </p>
      </div>
    </section>
  );
}