/** The school's three terms, and the names they had before (still found in old files and references). */
export const SCHOOL_TERMS = [
  { name: "Autumn Term", old: "First Term", words: ["1", "1st", "first", "autumn"] },
  { name: "Spring Term", old: "Second Term", words: ["2", "2nd", "second", "spring"] },
  { name: "Summer Term", old: "Third Term", words: ["3", "3rd", "third", "summer"] },
] as const;

/** "1st", "first", "1", "First Term" and "Autumn" all mean "Autumn Term"; anything else is not a term. */
export function normalTerm(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s*term\s*/, "");
  return SCHOOL_TERMS.find((x) => (x.words as readonly string[]).includes(t))?.name ?? null;
}

/**
 * The term as written in fee references. Charges billed before the rename carry the old name, so Autumn Term keeps
 * the First Term reference: billing a term again can never charge anyone twice.
 */
export const termForReference = (term: string) => SCHOOL_TERMS.find((x) => x.name.toLowerCase() === term.trim().toLowerCase())?.old ?? term;
