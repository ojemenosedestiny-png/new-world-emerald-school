/**
 * Year groups and their arms: "Year 11 Amber", "Year 11 Jade" and "Year 11 Chrysolite" are three arms of Year 11;
 * "JSS 1A" and "JSS 1B" are arms of JSS 1. A class with no arm is a group of one.
 */
const LEVEL = /\b(year|yr|grade|basic|primary|pry|jss|js|jhs|sss|ss|shs)\s*(\d{1,2})(?!\d)/i;

export type YearGroup = { key: string; label: string; order: number };

export function yearGroup(name: string): YearGroup {
  const m = LEVEL.exec(name);
  if (!m) return { key: name.trim().toLowerCase(), label: name.trim(), order: 1000 };
  const kind = m[1].toLowerCase(), n = Number(m[2]);
  const label = name.slice(0, m.index + m[0].length).trim().replace(/\s+/g, " ");
  // School order: Year/Primary 1 to 6, then JSS 1 to 3 (Year 7 to 9), then SS 1 to 3 (Year 10 to 12).
  const order = kind.startsWith("j") ? 6 + n : kind === "ss" || kind === "sss" || kind === "shs" ? 9 + n : n;
  return { key: label.toLowerCase(), label, order };
}

/** The arm's own name ("Amber" in "Year 11 Amber"), or "" when the class has none. */
export function armName(name: string) {
  const m = LEVEL.exec(name);
  return m ? name.slice(m.index + m[0].length).replace(/^[\s\-–:]+/, "").trim() : "";
}

/** Classes gathered into year groups, each group's arms in name order. */
export function groupClasses<T extends { name: string }>(classes: T[]): { group: YearGroup; classes: T[] }[] {
  const groups = new Map<string, { group: YearGroup; classes: T[] }>();
  for (const c of classes) {
    const g = yearGroup(c.name);
    const entry = groups.get(g.key) ?? { group: g, classes: [] };
    entry.classes.push(c);
    groups.set(g.key, entry);
  }
  for (const g of groups.values()) g.classes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return [...groups.values()];
}
