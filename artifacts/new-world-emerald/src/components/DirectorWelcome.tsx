import { AnimatedHeading } from "@/components/AnimatedHeading";
import { asset } from '@/lib/asset';

export function DirectorWelcome() {
  return (
    <section
      id="director-welcome"
      aria-labelledby="director-welcome-title"
      className="relative scroll-mt-28 overflow-hidden bg-[#f5f3e9] py-20 md:py-28"
      data-testid="section-director-welcome"
    >
      <div className="pointer-events-none absolute -right-24 top-12 h-72 w-72 rounded-full border border-primary/10 md:h-96 md:w-96" />
      <div className="pointer-events-none absolute -right-12 top-28 h-56 w-56 rounded-full border border-accent/30 md:h-72 md:w-72" />

      <div className="container relative mx-auto px-4 md:px-8">
        <div className="mb-10 max-w-3xl md:mb-14">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-primary md:text-sm">
            A personal welcome
          </p>
          <AnimatedHeading as="h2"
            id="director-welcome-title"
            className="font-serif text-4xl font-bold leading-tight text-secondary md:text-5xl"
          >
            A message from our <span className="text-primary">Director.</span>
          </AnimatedHeading>
        </div>

        <div className="grid items-start gap-10 md:grid-cols-[minmax(250px,0.72fr)_1.28fr] md:gap-16 lg:gap-20">
          <figure className="relative mx-auto w-full max-w-sm md:mx-0 md:pt-3">
            <div className="absolute -inset-3 translate-x-2 translate-y-2 rounded-[2rem] border border-accent/60" />
            <div className="relative overflow-hidden rounded-[1.75rem] bg-primary/10 shadow-xl">
              <img
                src={asset('/mrs-folakemi-olasanya.jpeg')}
                alt="Mrs. Folakemi Olasanya, Director of New World Emerald Private School"
                className="aspect-[4/5] w-full object-cover object-center"
                data-testid="img-director-portrait"
              />
            </div>
            <figcaption className="relative mt-5 border-l-2 border-accent pl-4">
              <p className="font-serif text-xl font-bold text-secondary">Mrs. Folakemi Olasanya</p>
              <p className="mt-1 text-sm font-medium tracking-wide text-muted-foreground">
                Director, New World Emerald Private School
              </p>
            </figcaption>
          </figure>

          <div className="max-w-3xl">
            <div className="mb-8 border-l-4 border-accent pl-5 md:pl-7">
              <p className="mb-5 font-serif text-2xl leading-snug text-secondary md:text-[1.75rem]">
                Dear Parents,
              </p>
              <p className="mb-4 text-base leading-8 text-foreground/80 md:text-lg">
                It is a pleasure to welcome you to New World Emerald Private School, situated in the heart of Kubwa, Abuja.
              </p>
              <p className="text-base leading-8 text-foreground/80 md:text-lg">
                Choosing a school for your child is an important decision. You want to feel confident that they will be cared for, encouraged, and given every opportunity to succeed. As Director, I take that responsibility seriously, and I am grateful that you are considering our school.
              </p>
            </div>

            <details className="group border-t border-primary/15 pt-5">
              <summary
                className="inline-flex cursor-pointer list-none items-center gap-3 rounded-md py-2 pr-2 font-semibold text-primary transition-colors hover:text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"
                data-testid="toggle-full-director-address"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full border border-primary/25 transition-colors group-open:bg-primary group-open:text-white">
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" fill="none">
                    <path d="m4 7 6 6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>Read the full welcome address</span>
              </summary>

              <article className="prose prose-slate mt-7 max-w-none border-l border-primary/15 pl-5 md:pl-8">
                <AnimatedHeading as="h3" className="font-serif text-2xl font-bold text-secondary">DIRECTOR’S WELCOME ADDRESS</AnimatedHeading>
                <p>Dear Parents,</p>
                <p>
                  It is a pleasure to welcome you to New World Emerald Private School, situated in the heart of Kubwa, Abuja.
                </p>
                <p>
                  Choosing a school for your child is an important decision. You want to feel confident that they will be cared for, encouraged, and given every opportunity to succeed. As Director, I take that responsibility seriously, and I am grateful that you are considering our school.
                </p>

                <AnimatedHeading as="h4">Our Vision and Mission</AnimatedHeading>
                <p>
                  Our vision is to nurture knowledgeable, confident, and independent learners. We want our children to think creatively, ask questions, show compassion for others, and develop the courage to make thoughtful decisions.
                </p>
                <p>
                  Our mission is to provide a rigorous academic programme through purposeful teaching, helping every student take responsibility for their learning and develop skills they can carry into the future.
                </p>

                <AnimatedHeading as="h4">Academic Programs</AnimatedHeading>
                <p>
                  We offer Cambridge and Nigerian curricula, beginning with the Early Years Foundation Stage (EYFS) and continuing through to GCSE level at age 16. For students aged 16 to 18, we offer three internationally recognised pathways:
                </p>
                <ul>
                  <li>English A Level</li>
                  <li>International Baccalaureate (IB) Diploma</li>
                  <li>BTEC Vocational Courses</li>
                </ul>

                <AnimatedHeading as="h4">Core Values</AnimatedHeading>
                <p>Our approach to education is guided by six core values:</p>
                <ul>
                  <li>Respect</li>
                  <li>Tolerance</li>
                  <li>Inclusion</li>
                  <li>Child-centredness</li>
                  <li>Integrity</li>
                  <li>Excellence</li>
                </ul>
                <p>
                  These values shape how we teach, support our students, and relate to one another. We want every child to feel valued, to respect others, and to take pride in doing their best.
                </p>

                <AnimatedHeading as="h4">Why Choose New World Emerald Private School?</AnimatedHeading>
                <p>
                  We welcome children from across Nigeria into an inclusive and caring learning community. Our experienced teachers provide individual attention and support, helping students build on their strengths and work through challenges.
                </p>
                <p>
                  We strive to create an environment where children enjoy learning, develop confidence, and grow both academically and personally.
                </p>

                <AnimatedHeading as="h4">Our Partnership with Parents</AnimatedHeading>
                <p>
                  We believe that a strong partnership between home and school makes a meaningful difference. Your understanding of your child, your involvement, and your support are essential parts of their educational journey. We look forward to building an open and supportive relationship with you.
                </p>
                <p>
                  Thank you for considering New World Emerald Private School. I look forward to getting to know you and working together to help your child reach their full potential.
                </p>
                <p className="mb-0">Warm regards,</p>
                <p className="mb-0 font-semibold">Mrs. Folakemi Olasanya</p>
                <p className="mb-0">Director, New World Emerald Private School</p>
              </article>
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}