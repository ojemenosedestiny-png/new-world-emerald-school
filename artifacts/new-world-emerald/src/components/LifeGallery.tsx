import { AnimatedHeading } from "@/components/AnimatedHeading";
import { asset } from "@/lib/asset";
import React, { useRef, useState } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SchoolLife() {
  const timeline = [
    { time: "08:00 AM", title: "Morning Assembly", desc: "Setting the tone for the day with inspiration and announcements." },
    { time: "08:30 AM", title: "Core Academics", desc: "Engaging classroom sessions in Math, Sciences, and Languages." },
    { time: "11:00 AM", title: "Creative Arts", desc: "Music, fine arts, and drama to foster creative expression." },
    { time: "01:00 PM", title: "Lunch & Social", desc: "Nutritious meals and free time to build friendships." },
    { time: "02:00 PM", title: "STEM Labs", desc: "Hands-on experiments and coding in our state-of-the-art labs." },
    { time: "03:30 PM", title: "Clubs & Sports", desc: "Extracurricular activities, debate, robotics, and athletics." },
  ];

  return (
    <section id="school-life" className="py-24 bg-muted/30">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <AnimatedHeading as="h2" className="text-primary font-bold tracking-widest uppercase text-sm mb-3">Student Experience</AnimatedHeading>
            <AnimatedHeading as="h3" className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6">
              A Day in the Life at Emerald.
            </AnimatedHeading>
            <p className="text-muted-foreground text-lg mb-8">
              Education extends beyond the four walls of a classroom. Our structured yet dynamic daily routine ensures students develop holistically—balancing rigorous academics with arts, sports, and leadership programs.
            </p>
            
            <div className="relative border-l-2 border-primary/20 pl-8 space-y-8">
              {timeline.map((item, i) => (
                <div key={i} className="relative">
                  <span className="absolute -left-[41px] top-1 w-5 h-5 bg-background border-4 border-primary rounded-full" />
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-1">
                    <span className="font-mono text-sm font-bold text-primary bg-primary/10 px-2 py-1 rounded w-fit">{item.time}</span>
                    <AnimatedHeading as="h4" className="font-serif text-lg font-bold text-foreground">{item.title}</AnimatedHeading>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <img src={asset("/primary.jpg")} alt="Classroom" className="w-full h-64 object-cover rounded-2xl rounded-tr-[4rem]" />
            <img src={asset("/sports.jpg")} alt="Sports" className="w-full h-64 object-cover rounded-2xl rounded-bl-[4rem] mt-8" />
            <img src={asset("/science-lab.jpg")} alt="Lab" className="w-full h-64 object-cover rounded-2xl rounded-br-[4rem] col-span-2" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function Gallery() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  const categories = [
    { id: 'all', label: 'All Photos' },
    { id: 'school-life', label: 'School Life' },
    { id: 'campus', label: 'Campus' },
    { id: 'academics', label: 'Academics' },
    { id: 'events', label: 'Events' },
  ];

  const images = [
    { src: asset("/school-gallery/school-life-1.jpg"), cat: 'school-life', alt: 'Emerald pupil arriving at school', aspect: 'aspect-[3/4]' },
    { src: asset("/school-gallery/school-life-2.jpg"), cat: 'school-life', alt: 'Emerald pupil ready for the school day', aspect: 'aspect-[3/4]' },
    { src: asset("/school-gallery/school-life-3.jpg"), cat: 'school-life', alt: 'Young pupil arriving with an adult', aspect: 'aspect-[3/4]' },
    { src: asset("/school-gallery/school-life-4.jpg"), cat: 'school-life', alt: 'Emerald student in school uniform on campus', aspect: 'aspect-[3/4]' },
    { src: asset("/school-gallery/school-life-5.jpg"), cat: 'school-life', alt: 'Young Emerald pupil welcomed at school', aspect: 'aspect-[3/4]' },
    { src: asset("/school-gallery/school-life-6.jpg"), cat: 'school-life', alt: 'Emerald student arriving on campus', aspect: 'aspect-[3/4]' },
    { src: asset("/school-gallery/school-life-7.jpg"), cat: 'school-life', alt: 'Emerald pupil smiling in school uniform', aspect: 'aspect-[3/4]' },
    { src: asset("/school-gallery/school-life-8.jpg"), cat: 'academics', alt: 'Pupils practising chess in the classroom', aspect: 'aspect-[3/4]' },
    { src: asset("/school-gallery/school-life-9.jpg"), cat: 'academics', alt: 'Teacher guiding pupils through a classroom activity', aspect: 'aspect-[3/4]' },
    { src: asset("/graduation.jpg"), cat: 'events', aspect: 'aspect-square' },
    { src: asset("/science-lab.jpg"), cat: 'academics', aspect: 'aspect-video' },
    { src: asset("/hero.jpg"), cat: 'campus', aspect: 'aspect-[3/4]' },
    { src: asset("/primary.jpg"), cat: 'academics', aspect: 'aspect-square' },
    { src: asset("/library.jpg"), cat: 'campus', aspect: 'aspect-video' },
    { src: asset("/sports.jpg"), cat: 'events', aspect: 'aspect-[3/4]' },
  ];

  const filteredImages = filter === 'all' ? images : images.filter(img => img.cat === filter);

  return (
    <section id="gallery" className="py-24 bg-background scroll-mt-28">
      <div className="container mx-auto px-4 md:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <AnimatedHeading as="h2" className="text-primary font-bold tracking-widest uppercase text-sm mb-3">Our Gallery</AnimatedHeading>
          <AnimatedHeading as="h3" className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-8">
            Moments of Excellence.
          </AnimatedHeading>
          
          <div className="flex flex-wrap justify-center gap-2">
            {categories.map(c => (
              <button 
                key={c.id}
                onClick={() => setFilter(c.id)}
                className={cn(
                  "px-6 py-2 rounded-full text-sm font-semibold transition-all",
                  filter === c.id 
                    ? "bg-primary text-primary-foreground shadow-md" 
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <motion.div 
          layout
          className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4"
        >
          <AnimatePresence>
            {filteredImages.map((img, i) => (
              <motion.button
                type="button"
                aria-label={`View ${img.alt ?? 'school gallery photo'}`}
                key={img.src}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                className={cn("relative block w-full rounded-2xl overflow-hidden group cursor-pointer break-inside-avoid border-4 border-card shadow-sm hover:shadow-lg transition-shadow duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary")}
                onClick={() => setSelectedImage(img.src)}
              >
                <img src={img.src} alt={img.alt ?? "School gallery photo"} loading="lazy" decoding="async" className="w-full h-auto object-cover" />
                <div className="absolute inset-0 bg-secondary/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                  <ZoomIn className="text-white w-10 h-10" />
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </motion.div>
        {(filter === 'all' || filter === 'events') && (
          <div className="mt-12 rounded-2xl border border-border bg-muted/30 p-5 md:p-8">
            <AnimatedHeading as="h4" className="mb-2 font-serif text-2xl font-bold text-foreground">Emerald’s Founders Championship</AnimatedHeading>
            <p className="mb-6 text-muted-foreground">Watch moments from our inter-schools championship.</p>
            <video
              controls
              playsInline
              preload="none"
              poster={asset("/school-gallery/video-poster.jpg")}
              aria-label="Emerald’s Founders Championship school video"
              className="mx-auto max-h-[70vh] w-full max-w-md rounded-xl bg-black"
            >
              <source src={asset("/school-gallery/new-world.mp4")} type="video/mp4" />
              Your browser does not support video playback. <a href={asset("/school-gallery/new-world.mp4")}>Download the school video.</a>
            </video>
          </div>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedImage(null)}
          >
            <button 
              aria-label="Close expanded photo"
              className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors"
              onClick={() => setSelectedImage(null)}
            >
              <X size={32} />
            </button>
            <motion.img 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              src={selectedImage} 
              alt="Expanded view" 
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" 
              onClick={e => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function Testimonials() {
  const [current, setCurrent] = useState(0);
  
  const reviews = [
    {
      text: "Transferring our children to New World Emerald was the best decision we ever made. The academic rigor combined with genuine care from teachers has transformed their confidence.",
      author: "Sarah Jenkins",
      role: "Parent of Year 8 & Year 11 Students"
    },
    {
      text: "The state-of-the-art facilities and focus on tech-forward learning means my son is well-prepared for university. The leadership programs are truly exceptional.",
      author: "David Olawale",
      role: "Parent of Year 12 Student"
    },
    {
      text: "I am constantly impressed by the rich extracurricular environment. My daughter has blossomed not just academically, but as a confident public speaker and athlete.",
      author: "Elena Rodriguez",
      role: "Parent of Year 5 Student"
    }
  ];

  const next = () => setCurrent((c) => (c + 1) % reviews.length);
  const prev = () => setCurrent((c) => (c - 1 + reviews.length) % reviews.length);

  return (
    <section className="py-24 bg-secondary text-secondary-foreground">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <AnimatedHeading as="h2" className="text-primary font-bold tracking-widest uppercase text-sm mb-3">Parent Voices</AnimatedHeading>
            <AnimatedHeading as="h3" className="text-4xl md:text-5xl font-serif font-bold text-white mb-8">
              Trusted by Families <br/>Across the Globe.
            </AnimatedHeading>
            <div className="flex gap-4">
              <button onClick={prev} className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10 transition-colors text-white">
                <ChevronLeft />
              </button>
              <button onClick={next} className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">
                <ChevronRight />
              </button>
            </div>
          </div>

          <div className="relative bg-white/5 border border-white/10 p-10 md:p-14 rounded-3xl backdrop-blur-sm">
            <span className="absolute top-8 left-8 text-6xl text-primary/20 font-serif">"</span>
            
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="relative z-10"
              >
                <div className="flex text-accent mb-6">
                  {[...Array(5)].map((_, i) => <Star key={i} size={20} fill="currentColor" />)}
                </div>
                <p className="text-xl md:text-2xl font-serif text-white leading-relaxed mb-8">
                  {reviews[current].text}
                </p>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/30 rounded-full flex items-center justify-center text-primary-foreground font-bold">
                    {reviews[current].author.charAt(0)}
                  </div>
                  <div>
                    <AnimatedHeading as="h5" className="font-bold text-white">{reviews[current].author}</AnimatedHeading>
                    <p className="text-sm text-secondary-foreground/60">{reviews[current].role}</p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
