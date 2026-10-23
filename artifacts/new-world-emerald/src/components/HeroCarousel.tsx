import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { asset } from "@/lib/asset";

const slides = [
  {
    src: "/images/homepage/back-to-school.webp",
    alt: "A pupil poses inside a handmade Back to School frame at the school entrance.",
    label: "Back to school",
  },
  {
    src: "/images/homepage/school-community.webp",
    alt: "Two adults and a pupil at the school entrance.",
    label: "At the school entrance",
  },
  {
    src: "/images/homepage/classroom-learning.webp",
    alt: "Pupils working through lesson books at classroom desks.",
    label: "Working through a lesson",
  },
  {
    src: "/images/homepage/student-study.webp",
    alt: "A pupil concentrating on a workbook at a classroom desk.",
    label: "Learning at the desk",
  },
  {
    src: "/images/homepage/teacher-guided-learning.webp",
    alt: "A teacher leads a lesson with pupils in the classroom.",
    label: "A guided classroom lesson",
  },
  {
    src: "/campus-building-background.webp",
    alt: "The New World Emerald Private School campus.",
    label: "The school campus",
    landscape: true,
  },
];

const ROTATION_INTERVAL_MS = 7500;

export function HeroCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      setPrefersReducedMotion(motionPreference.matches);
      if (motionPreference.matches) setIsPaused(true);
    };

    updatePreference();
    motionPreference.addEventListener("change", updatePreference);
    return () => motionPreference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (isPaused) return;

    const timer = window.setInterval(() => {
      if (!document.hidden) {
        setActiveIndex((index) => (index + 1) % slides.length);
      }
    }, ROTATION_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isPaused, prefersReducedMotion]);

  const selectSlide = (index: number) => {
    setActiveIndex(index);
    setIsPaused(true);
  };

  const slide = slides[activeIndex];

  return (
    <div
      role="region"
      aria-label="School photographs"
      aria-roledescription="carousel"
      className="mx-auto max-w-full lg:mr-0"
      data-testid="hero-photo-carousel"
    >
      <div className="relative mx-auto h-[min(54svh,460px)] min-h-[320px] w-full max-w-full overflow-hidden rounded-[1.75rem] border border-[#50362c]/10 bg-[#f0eadc] p-3 shadow-[0_18px_54px_rgba(80,54,44,0.13)] sm:rounded-[2rem] sm:p-4 lg:mr-0 lg:h-[min(76svh,680px)] lg:min-h-[560px] lg:max-w-[680px]">
        <AnimatePresence initial={false} mode="sync">
          <motion.img
            key={slide.src}
            src={asset(slide.src)}
            alt={slide.alt}
            data-testid={`hero-photo-${activeIndex + 1}`}
            fetchPriority={activeIndex === 0 ? "high" : "auto"}
            loading={activeIndex === 0 ? "eager" : "lazy"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.65,
              ease: "easeOut",
            }}
            className={`absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] rounded-[1.25rem] ${slide.landscape ? "object-cover" : "object-contain"} sm:inset-4 sm:h-[calc(100%-2rem)] sm:w-[calc(100%-2rem)] sm:rounded-[1.5rem]`}
          />
        </AnimatePresence>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-[#50362c]">
        <span
          aria-live={isPaused ? "polite" : "off"}
          className="min-w-0 truncate font-semibold"
          data-testid="hero-photo-caption"
        >
          Photo {activeIndex + 1} of {slides.length} · {slide.label}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => selectSlide((activeIndex - 1 + slides.length) % slides.length)}
            aria-label="Previous school photo"
            data-testid="button-previous-photo"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#50362c]/15 bg-white/80 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1266cc]"
          >
            <ArrowLeft aria-hidden="true" size={18} />
          </button>
          <button
            type="button"
            onClick={() => selectSlide((activeIndex + 1) % slides.length)}
            aria-label="Next school photo"
            data-testid="button-next-photo"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#50362c]/15 bg-white/80 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1266cc]"
          >
            <ArrowRight aria-hidden="true" size={18} />
          </button>
          <button
            type="button"
            onClick={() => setIsPaused((paused) => !paused)}
            aria-label={isPaused ? "Play school photos automatically" : "Pause school photos"}
            aria-pressed={isPaused}
            data-testid="button-toggle-photo-rotation"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#50362c] text-white transition-colors hover:bg-[#38241c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1266cc]"
          >
            {isPaused
              ? <Play aria-hidden="true" size={17} />
              : <Pause aria-hidden="true" size={17} />}
          </button>
        </div>
      </div>

      <div
        role="group"
        aria-label="Choose a school photo"
        className="mt-3 flex flex-wrap items-center gap-2"
        data-testid="hero-photo-pagination"
      >
        {slides.map((item, index) => (
          <button
            key={item.src}
            type="button"
            onClick={() => selectSlide(index)}
            aria-label={`Show photo ${index + 1}: ${item.label}`}
            aria-pressed={activeIndex === index}
            data-testid={`button-photo-${index + 1}`}
            className={`h-2.5 rounded-full transition-[width,background-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1266cc] motion-reduce:transition-none ${
              activeIndex === index
                ? "w-8 bg-[#1266cc]"
                : "w-2.5 bg-[#50362c]/25 hover:bg-[#50362c]/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
