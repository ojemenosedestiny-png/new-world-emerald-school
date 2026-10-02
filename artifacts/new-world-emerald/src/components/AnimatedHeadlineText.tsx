import { Fragment } from "react";
import { motion, useReducedMotion } from "framer-motion";

export function AnimatedHeadlineText({ text }: { text: string }) {
  const reduceMotion = useReducedMotion();
  const words = text.split(" ");

  return (
    <span aria-hidden="true">
      {words.map((word, wordIndex) => {
        const offset = words.slice(0, wordIndex).join(" ").length + (wordIndex > 0 ? 1 : 0);
        return (
          <Fragment key={`${word}-${wordIndex}`}>
            {wordIndex > 0 && " "}
            <span className="inline-block whitespace-nowrap">
              {Array.from(word).map((letter, letterIndex) => (
                <motion.span
                  key={`${wordIndex}-${letterIndex}`}
                  className="inline-block"
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.4,
                    delay: reduceMotion ? 0 : 0.3 + (offset + letterIndex) * 0.035,
                    ease: "easeOut",
                  }}
                >
                  {letter}
                </motion.span>
              ))}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}