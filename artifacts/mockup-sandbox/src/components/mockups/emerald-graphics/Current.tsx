import { motion } from 'framer-motion';
import './_group.css';
const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" as const } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.2 }
  }
};

export function Current() {
  return (
    <section className="relative h-[100dvh] min-h-[700px] flex items-center justify-center overflow-hidden">
      {/* Background Image & Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src="/__mockup/images/emerald-hero.jpg" 
          alt="Students on Campus" 
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-secondary/70 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
      </div>

      <div className="container relative z-10 mx-auto px-4 text-center mt-20">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="max-w-4xl mx-auto"
        >
          <motion.div variants={fadeUp} className="mb-6 flex justify-center">
            <span className="px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-sm font-medium uppercase tracking-widest">
              Excellence in Education
            </span>
          </motion.div>
          
          <motion.h1 
            variants={fadeUp}
            className="text-5xl md:text-7xl font-serif font-bold text-white mb-6 leading-[1.1]"
          >
            Building Future Leaders <br className="hidden md:block"/>
            <span className="text-accent italic">With Global Vision.</span>
          </motion.h1>
          
          <motion.p 
            variants={fadeUp}
            className="text-lg md:text-xl text-white/80 mb-10 max-w-2xl mx-auto leading-relaxed"
          >
            An elite international institution providing world-class education from Creche to Senior Secondary, shaping minds that will shape the future.
          </motion.p>
          
          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="#admissions" className="w-full sm:w-auto px-8 py-4 bg-primary text-primary-foreground rounded-full font-bold text-lg shadow-xl shadow-primary/20 hover:scale-105 transition-transform">
              Apply for 2025/2026
            </a>
            <a href="#about" className="w-full sm:w-auto px-8 py-4 bg-white/10 backdrop-blur-md text-white rounded-full font-bold text-lg border border-white/20 hover:bg-white/20 transition-colors">
              Schedule a Visit
            </a>
          </motion.div>
        </motion.div>
      </div>

      {/* Floating Stats Bar */}
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1, duration: 0.8 }}
        className="absolute bottom-0 left-0 right-0 z-20 hidden md:block"
      >
        <div className="container mx-auto px-4 translate-y-1/2">
          <div className="bg-card rounded-2xl shadow-2xl border border-border p-8 grid grid-cols-4 gap-8">
            {[
              { label: 'Years of Excellence', value: '25+' },
              { label: 'Active Students', value: '1,200+' },
              { label: 'Qualified Teachers', value: '150+' },
              { label: 'Graduation Rate', value: '100%' },
            ].map((stat, i) => (
              <div key={i} className="text-center border-r border-border last:border-0">
                <h4 className="text-4xl font-serif font-bold text-primary mb-2">{stat.value}</h4>
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wider">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

