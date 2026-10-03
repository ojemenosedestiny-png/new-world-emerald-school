import { AnimatedHeading } from "@/components/AnimatedHeading";
import { asset } from "@/lib/asset";
import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { ArrowRight, Beaker, MonitorPlay, Book, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Programs() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  const curriculumDetails = [
    { label: "Cambridge Curriculum" },
    { label: "Nigerian Curriculum" },
    { label: "Cambridge International Examination — Year 8" },
    { label: "Checkpoint (Cambridge)" },
    { label: "IGCSE — JSS 3" },
    { label: "BECE — ERC / NECO — JSS 3" },
    { label: "SSCE — WAEC" },
    { label: "SSCE — NECO" },
    { label: "SAT" },
    { label: "HMB (Pre-Degree)" },
  ];

  const programs = [
    {
      title: "Creche & Nursery",
      age: "6 Months - 5 Years",
      desc: "A warm, nurturing environment focused on early childhood development, sensory play, and basic foundational skills.",
      note: "Our youngest learners are introduced to school through play, exploration, and caring guidance. The early-years approach helps children develop communication, confidence, and independence while taking their first steps in literacy and numeracy.",
      focus: ["Play, sensory exploration, and early language", "Foundations in literacy and numeracy", "Social confidence and growing independence"],
      img: asset("/creche.jpg")
    },
    {
      title: "Primary School",
      age: "5 - 11 Years",
      desc: "Building a strong academic foundation with an emphasis on critical thinking, literacy, and numeracy.",
      note: "Primary learning builds on early foundations through reading, writing, mathematics, and curiosity about the world. Pupils are encouraged to ask questions, think creatively, and take increasing responsibility for their learning.",
      focus: ["Reading, writing, and numeracy", "Creative thinking and thoughtful questions", "Confidence, responsibility, and teamwork"],
      img: asset("/primary.jpg")
    },
    {
      title: "Junior Secondary",
      age: "11 - 14 Years",
      desc: "A transition phase encouraging independent learning, scientific inquiry, and broad subject exploration.",
      note: "Junior Secondary helps students move towards more independent study and a broader understanding of their subjects. Scientific inquiry, discussion, and problem-solving support students as they discover their strengths and prepare for the next stage.",
      focus: ["Broad subject exploration and scientific inquiry", "Independent learning and problem-solving", "Building strengths for Senior Secondary"],
      img: asset("/secondary.jpg")
    },
    {
      title: "Senior Secondary",
      age: "14 - 17 Years",
      desc: "Rigorous academic preparation for university and beyond, with specialized science, art, and commercial tracks.",
      note: "Senior Secondary focuses on deeper subject knowledge and preparation for further education. Science, arts, and commercial interests guide subject choices, while students continue developing the confidence and judgement needed for their next steps. Contact admissions for current subject combinations and entry guidance.",
      focus: ["Deeper study in science, arts, and commercial tracks", "Preparation for further education", "Independent study and thoughtful decision-making"],
      img: asset("/science-lab.jpg")
    }
  ];

  return (
    <section id="academics" className="py-24 md:py-32 bg-muted/30">
      <div className="container mx-auto px-4 md:px-8">
        <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-6">
          <div className="max-w-2xl">
            <AnimatedHeading as="h2" className="text-primary font-bold tracking-widest uppercase text-sm mb-3">Academic Structure</AnimatedHeading>
            <AnimatedHeading as="h3" className="text-4xl md:text-5xl font-serif font-bold text-foreground">
              Programs Designed for <br/>Every Stage of Growth.
            </AnimatedHeading>
            <p id="curriculum-overview" className="mt-5 scroll-mt-32 text-base leading-relaxed text-muted-foreground">
              Our academic programmes combine <strong className="font-semibold text-foreground">Cambridge and Nigerian curricula</strong>, helping pupils build strong foundations with both a national and international perspective.
            </p>
          </div>
          <a href="#curriculum-details" className="flex items-center gap-2 font-bold text-primary hover:text-accent transition-colors">
            View Curriculum Details <ArrowRight size={20} />
          </a>
        </div>

        <motion.div 
          ref={ref}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.15 } }
          }}
          className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {programs.map((prog, i) => (
            <motion.div 
              key={i}
              variants={{
                hidden: { opacity: 0, y: 30 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.6 } }
              }}
              className="bg-card rounded-2xl overflow-hidden border border-border shadow-sm group hover:shadow-xl hover:border-primary/30 transition-all duration-300"
            >
              <div className="relative h-56 overflow-hidden">
                <img 
                  src={prog.img} 
                  alt={prog.title} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 motion-reduce:transform-none"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-secondary/35 to-transparent pointer-events-none" />
                <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold text-primary border border-white/40 shadow-sm">
                  {prog.age}
                </div>
              </div>
              <div className="p-6">
                <AnimatedHeading as="h4" className="font-serif text-xl font-bold mb-3 group-hover:text-primary transition-colors">{prog.title}</AnimatedHeading>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  {prog.desc}
                </p>
                <details className="group/notes" data-testid={`program-notes-${i}`}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden" data-testid={`button-learn-more-${i}`}>
                    Learn More <ArrowRight size={16} className="transition-transform group-open/notes:rotate-90 motion-reduce:transition-none" />
                  </summary>
                  <div className="mt-5 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
                    <AnimatedHeading as="h5" className="mb-2 font-serif text-base font-bold text-foreground">School notes</AnimatedHeading>
                    <p>{prog.note}</p>
                    <ul className="mt-4 list-disc space-y-2 pl-4">
                      {prog.focus.map((point) => <li key={point}>{point}</li>)}
                    </ul>
                    <p className="mt-4"><strong className="font-semibold text-foreground">Our curriculum:</strong> Cambridge and Nigerian curricula, with learning adapted to each stage.</p>
                    <p className="mt-3">At New World Emerald, our vision is to nurture knowledgeable, confident, and independent learners.</p>
                    <a href={`mailto:info@newworldemeraldprivateschool.com?subject=${encodeURIComponent(`Enquiry about ${prog.title}`)}`} className="mt-4 inline-flex items-center gap-2 font-semibold text-primary underline underline-offset-4">
                      Ask about this programme <ArrowRight size={14} />
                    </a>
                  </div>
                </details>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <div id="curriculum-details" className="mt-12 scroll-mt-32 rounded-2xl border border-border bg-card p-6 md:p-9">
          <div className="max-w-3xl">
            <AnimatedHeading as="h4" className="font-serif text-2xl md:text-3xl font-bold text-foreground">
              Curriculum &amp; Academic Programmes
            </AnimatedHeading>
            <p className="mt-3 text-sm md:text-base leading-relaxed text-muted-foreground">
              New World Emerald offers Cambridge and Nigerian curricula. The programmes and examinations listed below are part of the school’s academic information.
            </p>
          </div>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {curriculumDetails.map((item, index) => (
              <li
                key={item.label}
                data-testid={`curriculum-entry-${index}`}
                className="flex min-h-12 items-center gap-3 rounded-xl bg-muted/50 px-4 py-3 text-sm font-medium leading-snug text-foreground"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Facilities() {
  const facilities = [
    { name: "Science Laboratories", img: asset("/science-lab.jpg"), icon: Beaker, colSpan: "col-span-1 md:col-span-2 lg:col-span-2", rowSpan: "row-span-2" },
    { name: "Expansive Library", img: asset("/library.jpg"), icon: Book, colSpan: "col-span-1", rowSpan: "row-span-1" },
    { name: "Sports Complex", img: asset("/sports.jpg"), icon: Trophy, colSpan: "col-span-1", rowSpan: "row-span-1" },
    { name: "ICT & Coding Center", img: asset("/hero.jpg"), icon: MonitorPlay, colSpan: "col-span-1 md:col-span-2", rowSpan: "row-span-1" },
  ];

  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4 md:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <AnimatedHeading as="h2" className="text-primary font-bold tracking-widest uppercase text-sm mb-3">Campus & Facilities</AnimatedHeading>
          <AnimatedHeading as="h3" className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6">
            An Environment Built <br/>for Excellence.
          </AnimatedHeading>
          <p className="text-muted-foreground text-lg">
            Our purpose-built campus provides students with the tools they need to explore, discover, and excel in every discipline.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-[250px]">
          {facilities.map((fac, i) => (
            <div 
              key={i} 
              className={cn(
                "relative rounded-2xl overflow-hidden group cursor-pointer",
                fac.colSpan, fac.rowSpan
              )}
            >
              <img 
                src={fac.img} 
                alt={fac.name} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-end p-6 md:p-8">
                <div className="translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                  <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center mb-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <fac.icon size={24} />
                  </div>
                  <AnimatedHeading as="h4" className="font-serif text-2xl font-bold text-white">{fac.name}</AnimatedHeading>
                </div>
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-12 text-center">
          <button className="px-8 py-4 bg-secondary text-secondary-foreground rounded-full font-bold text-lg hover:bg-secondary/90 transition-colors inline-flex items-center gap-2">
            Take a Virtual Campus Tour <MonitorPlay size={20} />
          </button>
        </div>
      </div>
    </section>
  );
}
