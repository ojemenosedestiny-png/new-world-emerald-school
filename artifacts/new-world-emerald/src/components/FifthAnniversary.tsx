import { AnimatedHeading } from "@/components/AnimatedHeading";
import { asset } from "@/lib/asset";

const anniversaryPhotographs = [
  {
    src: asset("/anniversary-pupil.webp"),
    alt: "A smiling New World Emerald pupil during a moment of school life",
    className: "aspect-[4/5] object-[center_36%]",
  },
  {
    src: asset("/anniversary-chess.webp"),
    alt: "Pupils learning together around a chessboard in class",
    className: "aspect-[1/1] object-[center_42%]",
  },
  {
    src: asset("/anniversary-learning.webp"),
    alt: "A teacher guiding pupils as they learn together at a laptop",
    className: "aspect-[4/3] object-[center_40%]",
  },
];

export function FifthAnniversary() {
  return (
    <section
      id="anniversary"
      aria-labelledby="anniversary-title"
      className="scroll-mt-28 overflow-hidden bg-[#f4f1e7] py-16 sm:py-20 lg:py-28"
    >
      <div className="container mx-auto px-4 md:px-8">
        <div className="relative isolate overflow-hidden rounded-[1.5rem] bg-[#0d382b] text-[#f8f4e9] shadow-[0_24px_70px_-35px_rgba(16,50,38,0.55)] sm:rounded-[2rem]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.12]">
            <div className="absolute -right-24 -top-28 h-80 w-80 rounded-full border border-[#d6b765] sm:h-[27rem] sm:w-[27rem]" />
            <div className="absolute -right-12 -top-16 h-56 w-56 rounded-full border border-[#d6b765] sm:h-[20rem] sm:w-[20rem]" />
          </div>

          <div className="relative grid items-center gap-10 p-6 sm:p-10 md:gap-12 md:p-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:p-16">
            <div className="relative z-10 max-w-xl">
              <div className="mb-8 inline-flex items-center gap-3">
                <span className="h-px w-9 bg-[#d6b765]" />
                <span className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#e3ca80]">
                  Celebrating our 5th anniversary
                </span>
              </div>

              <div className="mb-5 flex items-end gap-4 sm:gap-5">
                <span aria-hidden="true" className="font-serif text-[5.5rem] leading-[0.78] tracking-[-0.08em] text-[#d6b765] sm:text-[7.5rem]">
                  05
                </span>
                <span className="mb-1 border-l border-[#d6b765]/55 pl-4 text-xs font-medium uppercase leading-relaxed tracking-[0.2em] text-[#f4e8c5] sm:pl-5">
                  years of<br />learning together
                </span>
              </div>

              <AnimatedHeading
                as="h2"
                id="anniversary-title"
                className="font-serif text-4xl leading-[1.08] tracking-[-0.035em] text-[#fbf8ef] sm:text-5xl lg:text-[3.6rem]"
              >
                Five years, made possible together.
              </AnimatedHeading>

              <p className="mt-6 max-w-lg text-base leading-7 text-[#e4e9df] sm:text-lg sm:leading-8">
                New World Emerald Private School has completed five years. We are grateful to every pupil, family and member of staff who has been part of this journey.
              </p>
              <p className="mt-4 max-w-lg text-sm leading-7 text-[#c8d5cb] sm:text-base">
                The everyday moments of curiosity, care and discovery are what make our school community special. We celebrate them—and look ahead to all that we will learn together next.
              </p>

              <div className="mt-8 flex items-center gap-3 text-sm font-semibold text-[#e3ca80]">
                <span aria-hidden="true" className="h-px w-8 bg-[#d6b765]" />
                With gratitude, New World Emerald
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[38rem] lg:ml-auto">
              <figure className="relative w-[62%] overflow-hidden rounded-t-[48%] rounded-b-[1.25rem] border border-[#e3ca80]/45 bg-[#174a39] shadow-[0_18px_44px_-22px_rgba(0,0,0,0.6)]">
                <img
                  src={anniversaryPhotographs[0].src}
                  alt={anniversaryPhotographs[0].alt}
                  className={`block w-full object-cover ${anniversaryPhotographs[0].className}`}
                  loading="lazy"
                />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#09271f]/85 to-transparent px-4 pb-4 pt-12 text-xs font-medium tracking-wide text-white sm:px-5 sm:pb-5">
                  A moment from school life
                </figcaption>
              </figure>
              <figure className="absolute right-0 top-[9%] w-[39%] overflow-hidden rounded-[1rem] border-4 border-[#0d382b] bg-[#174a39] shadow-[0_18px_44px_-22px_rgba(0,0,0,0.6)] sm:rounded-[1.25rem]">
                <img
                  src={anniversaryPhotographs[1].src}
                  alt={anniversaryPhotographs[1].alt}
                  className={`block w-full object-cover ${anniversaryPhotographs[1].className}`}
                  loading="lazy"
                />
              </figure>
              <figure className="absolute bottom-[3%] right-[2%] w-[52%] overflow-hidden rounded-[1rem] border-4 border-[#0d382b] bg-[#174a39] shadow-[0_18px_44px_-22px_rgba(0,0,0,0.6)] sm:rounded-[1.25rem]">
                <img
                  src={anniversaryPhotographs[2].src}
                  alt={anniversaryPhotographs[2].alt}
                  className={`block w-full object-cover ${anniversaryPhotographs[2].className}`}
                  loading="lazy"
                />
              </figure>
              <div aria-hidden="true" className="absolute bottom-[2%] left-[55%] -z-10 h-16 w-16 rounded-full border border-[#d6b765]/70 sm:h-24 sm:w-24" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}