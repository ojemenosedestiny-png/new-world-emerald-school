/**
 * How a class is assessed (the server decides from the class's name).
 * Secondary (JSS 1 to SS 3): CA (1 and 2) + exam, out of the term's maxima, with positions.
 * Primary (Year 1 to Year 6): a Mid-term and an End-term mark per subject, each out of 100, stored as CA and exam;
 * the final mark is their average, shown as a percentage and average with no positions.
 */
export type ResultScheme = "primary" | "secondary";

type Maxima = { caMax: number; ca2Max?: number; examMax: number };

/** The term as a class sees it: primary classes use 100 and 100 whatever the term's CA and exam maxima are. */
export function schemeTerm<T extends Maxima>(term: T, scheme: ResultScheme | undefined): T {
  return scheme === "primary" ? { ...term, caMax: 100, ca2Max: 0, examMax: 100 } : term;
}

/** What one subject's final mark is out of. */
export const schemePossible = (term: Maxima, scheme: ResultScheme | undefined) => (scheme === "primary" ? 100 : term.caMax + (term.ca2Max ?? 0) + term.examMax);

/** A subject's final mark from its parts: the average of the two for primary, the sum for secondary. */
export function schemeTotal(scheme: ResultScheme | undefined, ca: number | null, ca2: number | null, exam: number | null) {
  const t = scheme === "primary" ? ((ca ?? 0) + (exam ?? 0)) / 2 : (ca ?? 0) + (ca2 ?? 0) + (exam ?? 0);
  return Math.round(t * 10) / 10;
}

/** Column names for the score parts. */
export function partLabels(scheme: ResultScheme | undefined, twoCa: boolean) {
  if (scheme === "primary") return { ca: "Mid-term", ca2: "", exam: "End-term", total: "Final" };
  return { ca: twoCa ? "CA 1" : "CA", ca2: "CA 2", exam: "Exam", total: "Total" };
}
