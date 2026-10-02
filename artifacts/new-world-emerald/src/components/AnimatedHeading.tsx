import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

const HeadingAnimationContext = createContext(false);

export function HomepageHeadingAnimations({ children }: { children: ReactNode }) {
  return <HeadingAnimationContext.Provider value={true}>{children}</HeadingAnimationContext.Provider>;
}

function plainText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return plainText(child.props.children);
    return "";
  }).join(" ");
}

function animateLetters(children: ReactNode, visible: boolean, step: number, cursor: { index: number }): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      return String(child).split(/(\s+)/).map((word, wordIndex) => {
        if (!word || /^\s+$/.test(word)) return word;
        return (
          <span className="inline-block whitespace-nowrap" key={wordIndex}>
            {Array.from(word).map((letter) => {
              const index = cursor.index++;
              return (
                <motion.span
                  key={index}
                  className="inline-block"
                  initial={{ opacity: 0, y: 8 }}
                  animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                  transition={{ duration: 0.35, delay: visible ? 0.08 + index * step : 0, ease: "easeOut" }}
                >
                  {letter}
                </motion.span>
              );
            })}
          </span>
        );
      });
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children !== undefined) {
      return cloneElement(child, {}, animateLetters(child.props.children, visible, step, cursor));
    }
    return child;
  });
}

type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
};

export function AnimatedHeading({ as: Heading = "h2", children, ...props }: HeadingProps) {
  const enabled = useContext(HeadingAnimationContext);
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLHeadingElement>(null);
  const visible = useInView(ref, { once: true, amount: 0.15 });
  const text = plainText(children).replace(/\s+/g, " ").trim();

  // Shared sections keep their original behaviour everywhere except the homepage.
  if (!enabled || reduceMotion || !text) {
    return <Heading {...props}>{children}</Heading>;
  }

  const step = Math.min(0.025, 0.7 / Math.max(Array.from(text).length, 1));
  return (
    <Heading {...props} ref={ref} aria-label={props["aria-label"] ?? text} data-heading-animation="letters">
      <span aria-hidden="true">{animateLetters(children, visible, step, { index: 0 })}</span>
    </Heading>
  );
}