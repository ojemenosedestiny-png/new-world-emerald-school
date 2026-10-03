import { AnimatedHeading } from "@/components/AnimatedHeading";
import React, { useRef } from 'react';
import { motion, useInView, MotionConfig } from 'framer-motion';
import { BookOpen, Shield, Globe, Award, Users, Lightbulb, Target, Heart } from 'lucide-react';
import { asset } from '@/lib/asset';
import { AnimatedHeadlineText } from '@/components/AnimatedHeadlineText';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } }
};

const staggerContainer = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } }
};

export function Hero() {
  return (
    <MotionConfig reducedMotion="user">
      <section className="relative isolate flex min-h-[590px] items-center overflow-hidden bg-secondary pt-24 pb-14 sm:min-h-[620px] sm:pt-28 md:min-h-[650px] md:py-28">
        <img
          src={asset("/campus-building-background.webp")}
          alt="New World Emerald Private School campus"
          className="absolute inset-0 -z-20 h-full w-full object-cover object-center"
          fetchPriority="high"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-secondary/95 via-secondary/80 to-secondary/30 md:via-secondary/75" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-secondary/45 via-transparent to-secondary/20" />

        <div className="container relative z-10 mx-auto px-5 sm:px-8">
          <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="max-w-3xl">
            <motion.p variants={fadeUp} className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-accent sm:text-sm">
              New World Emerald Private School
            </motion.p>
            <motion.h1
              variants={fadeUp}
              aria-label="Building Future Leaders With Global Vision."
              data-testid="hero-headline"
              className="mb-5 max-w-[15ch] font-serif text-[clamp(2rem,8.2vw,4.6rem)] font-bold leading-[1.08] tracking-[-0.035em] text-white sm:max-w-[17ch] sm:text-5xl md:mb-6 md:text-7xl"
            >
              <span className="block"><AnimatedHeadlineText text="Building Future Leaders" /></span>
              <span className="mt-1 block text-accent"><AnimatedHeadlineText text="With Global Vision." /></span>
            </motion.h1>
            <motion.p variants={fadeUp} className="mb-7 max-w-xl text-[15px] leading-7 text-white/90 sm:text-base md:mb-8 md:text-lg">
              Offering Cambridge and Nigerian curricula from Creche to Senior Secondary, with a focus on academic excellence and character development.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
              <a href="#admissions" data-testid="link-hero-apply" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-5 py-3 text-sm font-bold text-secondary shadow-md transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:px-6 sm:text-base">
                Apply now
              </a>
              <a href="#about" data-testid="link-hero-visit" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/55 bg-secondary/30 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:px-6 sm:text-base">
                Schedule a Visit
              </a>
            </motion.div>
          </motion.div>
        </div>
      </section>
    </MotionConfig>
  );
}

export function About() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="about" className="py-24 md:py-32 bg-background relative overflow-hidden" ref={ref}>
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
      
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            <div>
              <AnimatedHeading as="h2" className="text-primary font-bold tracking-widest uppercase text-sm mb-3">Our Heritage</AnimatedHeading>
              <AnimatedHeading as="h3" className="text-4xl md:text-5xl font-serif font-bold text-foreground leading-tight">
                A Tradition of <br/>
                <span className="text-accent">Academic Distinction.</span>
              </AnimatedHeading>
            </div>
            
            <p className="text-muted-foreground leading-relaxed text-lg">
              New World Emerald Private School celebrates five years of nurturing young learners in an environment where academic rigour meets character development. We thank our pupils, families, teachers and staff for being part of this journey as we look forward to the years ahead.
            </p>
            
            <div className="grid sm:grid-cols-2 gap-6 pt-4">
              <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
                <Target className="text-primary w-10 h-10 mb-4" />
                <AnimatedHeading as="h4" className="font-serif text-xl font-bold mb-2">Our Mission</AnimatedHeading>
                <p className="text-sm leading-relaxed text-muted-foreground">Our mission is to provide a rigorous academic programme through purposeful teaching, helping every student take responsibility for their learning and develop skills they can carry into the future.</p>
              </div>
              <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
                <Globe className="text-accent w-10 h-10 mb-4" />
                <AnimatedHeading as="h4" className="font-serif text-xl font-bold mb-2">Our Vision</AnimatedHeading>
                <p className="text-sm leading-relaxed text-muted-foreground">Our vision is to nurture knowledgeable, confident, and independent learners. We want our children to think creatively, ask questions, show compassion for others, and develop the courage to make thoughtful decisions.</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={isInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.5 }}
            className="relative"
          >
            <div className="absolute inset-0 bg-primary rounded-3xl translate-x-4 translate-y-4" />
            <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-xl">
              <img
                src={asset("/library.jpg")}
                alt="A welcoming learning space at New World Emerald Private School"
                className="min-h-[420px] w-full object-cover md:min-h-[560px]"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-secondary/90 via-secondary/45 to-transparent px-7 pb-7 pt-24 md:px-10 md:pb-10">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">A place to grow</p>
                <p className="mt-2 max-w-sm font-serif text-2xl font-semibold leading-snug text-white md:text-3xl">
                  A caring community, built around every child.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export function WhyChooseUs() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  const features = [
    { icon: Award, title: "World-Class Faculty", desc: "Our educators are passionate, highly qualified professionals drawn from across the globe." },
    { icon: BookOpen, title: "Cambridge & Nigerian Curricula", desc: "Combining Cambridge and Nigerian curricula to build strong academic foundations with a national and international outlook." },
    { icon: Lightbulb, title: "STEM & ICT Focus", desc: "State-of-the-art labs and integrated technology to prepare for the digital future." },
    { icon: Shield, title: "Safe Environment", desc: "24/7 security, medical facilities, and a zero-tolerance anti-bullying policy." },
    { icon: Heart, title: "Character Development", desc: "Emphasis on empathy, leadership, and integrity beyond academics." },
    { icon: Users, title: "Small Class Sizes", desc: "Ensuring personalized attention and tailored learning for every student." },
  ];

  return (
    <section className="py-24 bg-secondary text-secondary-foreground relative">
      <div className="container mx-auto px-4 md:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <AnimatedHeading as="h2" className="text-accent font-bold tracking-widest uppercase text-sm mb-3">Why Choose Us</AnimatedHeading>
          <AnimatedHeading as="h3" className="text-4xl md:text-5xl font-serif font-bold text-white mb-6">
            The Emerald Advantage
          </AnimatedHeading>
          <p className="text-secondary-foreground/80 text-lg">
            We offer more than just an education. We provide an environment where excellence becomes a habit.
          </p>
        </div>

        <motion.div 
          ref={ref}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          variants={staggerContainer}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-8"
        >
          {features.map((feature, i) => (
            <motion.div 
              key={i}
              variants={fadeUp}
              className="group bg-white/5 border border-white/10 p-8 rounded-2xl hover:bg-white/10 transition-all duration-300 hover:-translate-y-1"
            >
              <div className="w-14 h-14 bg-accent/10 text-accent border border-accent/20 rounded-xl flex items-center justify-center mb-6">
                <feature.icon size={28} />
              </div>
              <AnimatedHeading as="h4" className="font-serif text-xl font-bold text-white mb-3">{feature.title}</AnimatedHeading>
              <p className="text-secondary-foreground/70 leading-relaxed">
                {feature.desc}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
