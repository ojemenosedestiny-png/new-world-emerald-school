import { AnimatedHeading } from "@/components/AnimatedHeading";
import { ArrowUpRight, ClipboardList, HandHeart, MessagesSquare, Puzzle } from "lucide-react";

const support = [
  {
    icon: HandHeart,
    title: "Getting to know your child",
    desc: "We start by listening. We meet you, read any reports from previous schools or specialists, and watch how your child learns best in class.",
  },
  {
    icon: ClipboardList,
    title: "A plan for every child",
    desc: "Together we agree clear, achievable learning goals and the support that will help reach them, and we review the plan with you every term.",
  },
  {
    icon: Puzzle,
    title: "Support in the classroom",
    desc: "Teachers adapt lessons, materials and pace, offer small-group or one-to-one help where it is needed, and can give extra time in tests and exams.",
  },
  {
    icon: MessagesSquare,
    title: "Working in partnership",
    desc: "You hear from us regularly about progress, and you can message your child's class teacher through the parent and student portal at any time.",
  },
];

/** Special educational needs: how the school includes and supports every learner. All text is editable in Website content. */
export function SpecialNeeds() {
  return (
    <section id="special-needs" aria-labelledby="special-needs-title" className="relative overflow-hidden bg-background py-14 md:py-20" data-testid="section-special-needs">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
          <div className="max-w-xl">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Special Educational Needs (SEN)</p>
            <AnimatedHeading as="h2" id="special-needs-title" className="font-serif text-3xl font-bold leading-tight text-secondary md:text-[2.4rem]">
              Every child can <span className="text-primary">thrive here.</span>
            </AnimatedHeading>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              Inclusion and child-centredness are two of our core values. We welcome children with different learning needs and work closely with each family to understand their child and plan the support that helps them learn with confidence.
            </p>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Whether your child has dyslexia, attention difficulties, autism, speech and language needs, or a physical or sensory need, please talk to us. We will be honest about how we can support your child and agree the next steps together.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="mailto:info@newworldemeraldprivateschool.com?subject=Special%20Educational%20Needs%20enquiry"
                className="group inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                data-testid="link-sen-enquiry"
              >
                Talk to us about your child
                <ArrowUpRight aria-hidden="true" size={16} />
              </a>
              <a
                href="tel:+2348136037074"
                className="inline-flex items-center gap-2 rounded-xl border border-primary/20 px-5 py-3 text-sm font-semibold text-secondary transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                data-testid="link-sen-phone"
              >
                Call +234 813 603 7074
              </a>
            </div>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2" aria-label="How we support children with special educational needs">
            {support.map((item) => (
              <li key={item.title} className="rounded-2xl border border-primary/10 bg-[#f5f3e9] p-6" data-testid="card-sen-support">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><item.icon aria-hidden="true" size={21} strokeWidth={1.8} /></span>
                <h3 className="mt-4 font-serif text-xl font-semibold text-secondary">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
