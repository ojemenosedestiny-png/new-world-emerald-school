import { AnimatedHeading } from "@/components/AnimatedHeading";
import { ArrowUpRight, BookOpenCheck, Shirt } from 'lucide-react';
import { Link } from 'wouter';
import { ParentCommercePreview } from "@/components/ParentCommercePreview";

const services = [
  {
    title: 'School fees',
    href: '/commerce?section=fees',
    icon: BookOpenCheck,
    testId: 'link-parent-school-fees',
  },
  {
    title: 'Uniforms & materials',
    href: '/commerce?section=shop',
    icon: Shirt,
    testId: 'link-parent-uniforms-materials',
  },
];

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
              School essentials, <span className="text-primary">in one place.</span>
            </AnimatedHeading>
          </div>
        <ParentCommercePreview />
          <div className="mt-5 flex flex-wrap gap-3">
            {services.map(({ title, href, icon: Icon, testId }) => (
              <Link
                key={title}
                href={href}
                data-testid={testId}
                className="group inline-flex items-center gap-2 rounded-xl border border-primary/15 bg-background/75 px-4 py-3 text-sm font-semibold text-secondary transition-colors hover:border-primary/40 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary motion-reduce:transition-none"
              >
                <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                <span>{title}</span>
                <ArrowUpRight aria-hidden="true" size={14} className="text-primary" />
              </Link>
            ))}
          </div>
        <p className="mt-6 flex items-start gap-2 border-t border-primary/10 pt-4 text-xs leading-5 text-muted-foreground">
          <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          Payments are made externally, not processed on this website. The School Office verifies payment reports.
        </p>
      </div>
    </section>
  );
}