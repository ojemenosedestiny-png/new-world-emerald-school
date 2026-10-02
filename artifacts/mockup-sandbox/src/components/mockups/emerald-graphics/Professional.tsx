import { motion, MotionConfig } from 'framer-motion';
import './_group.css';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } }
};

const staggerContainer = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } }
};

const stats = [
  { label: 'Years of Excellence', value: '25+' },
  { label: 'Active Students', value: '1,200+' },
  { label: 'Qualified Teachers', value: '150+' },
  { label: 'Graduation Rate', value: '100%' },
];

export function Professional() {
  return (
    <MotionConfig reducedMotion="user">
    <div className="relative">
    <section className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden pb-32 pt-28">
      <div className="absolute inset-0 z-0">
        <img src={"/__mockup/images/emerald-hero.jpg"} alt="Students on the New World Emerald campus" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-br from-secondary/90 via-secondary/70 to-primary/60" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" />
        <div className="absolute inset-x-0 top-0 h-1 bg-accent" />
      </div>

      <div className="container relative z-10 mx-auto px-4 text-center">
        <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="max-w-4xl mx-auto">
          <motion.div variants={fadeUp} className="mb-6 flex justify-center">
            <span className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-secondary/50 backdrop-blur-sm border border-accent/40 text-white text-xs md:text-sm font-medium uppercase tracking-widest">
              <img src={"/__mockup/images/emerald-logo.jpg"} alt="" className="h-6 w-6 rounded-full object-cover" />
              Creche to Senior Secondary
            </span>
          </motion.div>
          <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl md:text-7xl font-serif font-bold text-white mb-6 leading-[1.1]">
            Building Future Leaders <br className="hidden md:block"/>
            <span className="text-accent italic">With Global Vision.</span>
          </motion.h1>
          <motion.p variants={fadeUp} className="text-lg md:text-xl text-white/85 mb-10 max-w-2xl mx-auto leading-relaxed">
            An elite international institution providing world-class education from Creche to Senior Secondary, shaping minds that will shape the future.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="#admissions" data-testid="link-hero-apply" className="w-full sm:w-auto px-8 py-4 bg-accent text-secondary rounded-full font-bold text-lg shadow-lg transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              Apply now
            </a>
            <a href="#about" data-testid="link-hero-visit" className="w-full sm:w-auto px-8 py-4 bg-white/10 backdrop-blur-sm text-white rounded-full font-bold text-lg border border-white/30 hover:bg-white/20 transition-colors">
              Schedule a Visit
            </a>
          </motion.div>
        </motion.div>
      </div>
    </section>

    <div className="relative z-20 -mt-16 md:-mt-20 px-4 pb-8">
      <div className="container mx-auto">
        <div data-testid="hero-stats" className="bg-card rounded-2xl shadow-xl border border-border border-t-4 border-t-accent p-6 md:p-8 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {stats.map((stat, i) => (
            <div key={i} className="text-center md:border-r md:border-border md:last:border-0">
              <p className="text-3xl md:text-4xl font-serif font-bold text-primary mb-1">{stat.value}</p>
              <p className="text-xs md:text-sm text-muted-foreground font-medium uppercase tracking-wider">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
    </MotionConfig>
  );
}


export default Professional;
