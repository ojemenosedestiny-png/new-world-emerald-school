import { ADMISSION_NUMBER, type IdSection } from "./accounts";
import { classSection } from "./principal";

/** The section a class's student IDs use: secondary for JSS/SS (Year 7 to 12), primary for every other class. */
export function idSectionForClass(className: string): IdSection {
  return classSection(className) === "secondary" ? "secondary" : "primary";
}

/** An admission number as typed: capitals, no spaces ("nw / sec / 26 / 00001" becomes "NW/SEC/26/00001"). */
export function cleanAdmissionNumber(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "");
}

export type IdListRow = { line: number; newId: string; name: string; problem: string | null };
const ID_IN_LINE = /N\s*W\s*\/\s*(SEC|PRY)\s*\/\s*\d{2}\s*\/\s*\d{5,6}/i;

/**
 * The school's list of admission numbers and names, pasted from Excel, a CSV file or a PDF: one student per line, with
 * the admission number somewhere in the line and the name after it (a serial number before it is ignored, and so
 * are header lines and empty columns).
 */
export function parseIdList(text: string): IdListRow[] {
  const rows: IdListRow[] = [];
  const seen = new Map<string, number>();
  text.replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const m = ID_IN_LINE.exec(raw);
    if (!m) return;
    const newId = cleanAdmissionNumber(m[0]);
    const name = raw.slice(m.index + m[0].length).split(/\t|,|;|\|/).map((x) => x.trim().replace(/^"|"$/g, "")).find((x) => x) ?? "";
    const tidy = name.replace(/\s+/g, " ").trim();
    let problem: string | null = null;
    if (!ADMISSION_NUMBER.test(newId)) problem = "Not an admission number like NW/SEC/26/00001.";
    else if (!tidy) problem = "No name after the admission number.";
    else if (seen.has(newId)) problem = `This admission number is also on line ${seen.get(newId)}.`;
    if (!seen.has(newId)) seen.set(newId, i + 1);
    rows.push({ line: i + 1, newId, name: tidy, problem });
  });
  return rows;
}

/** The words of a name, for matching: lower case, letters only, in any order ("Adegbola AnjolaOluwa" = "Anjolaoluwa Adegbola"). */
export function nameWords(name: string): string[] {
  return [...new Set(name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim().split(" ").filter(Boolean))].sort();
}

export type PortalStudentForIds = { id: number; studentId: string; name: string; className: string; active: boolean };
export type IdPlanRow = IdListRow & {
  status: "match" | "close" | "already" | "unmatched" | "ambiguous" | "problem" | "taken";
  student: PortalStudentForIds | null;
  message: string;
};

/**
 * Pairs each listed admission number with a student in the portal, by name, within the same section (SEC or PRY):
 * - "match": the same words in the name (any order);
 * - "close": one name contains the other (a middle name or initial missing), and only one student fits;
 * - "already": the student has this admission number already;
 * - "unmatched", "ambiguous" (two students or two lines fit), "taken" (another student already has the number).
 * Nothing is changed here; the office checks the plan and then applies it.
 */
export function planIdChanges(rows: IdListRow[], students: PortalStudentForIds[]): IdPlanRow[] {
  const byId = new Map(students.map((s) => [s.studentId.toUpperCase(), s]));
  const words = new Map(students.map((s) => [s.id, nameWords(s.name)]));
  const sectionOf = (s: PortalStudentForIds) => (idSectionForClass(s.className) === "secondary" ? "SEC" : "PRY");
  const findFor = (row: IdListRow): { student: PortalStudentForIds | null; status: IdPlanRow["status"]; message: string } => {
    const holder = byId.get(row.newId);
    const want = nameWords(row.name);
    const key = want.join(" ");
    if (holder) {
      const same = words.get(holder.id)!.join(" ") === key;
      return same || !key ? { student: holder, status: "already", message: "Already has this admission number." }
        : { student: holder, status: "taken", message: `${holder.name} already has this admission number.` };
    }
    const section = row.newId.split("/")[1];
    const pools = [students.filter((s) => sectionOf(s) === section), students];
    for (const pool of pools) {
      const exact = pool.filter((s) => words.get(s.id)!.join(" ") === key);
      if (exact.length === 1) return { student: exact[0], status: "match", message: "" };
      if (exact.length > 1) return { student: null, status: "ambiguous", message: `${exact.length} students have this name. Choose the right one.` };
    }
    const significant = want.filter((w) => w.length > 1);
    if (significant.length >= 2) {
      for (const pool of pools) {
        const near = pool.filter((s) => {
          const have = words.get(s.id)!.filter((w) => w.length > 1);
          const shared = significant.filter((w) => have.includes(w)).length;
          return shared >= 2 && (shared === significant.length || shared === have.length);
        });
        if (near.length === 1) return { student: near[0], status: "close", message: `Name in the portal: ${near[0].name}.` };
        if (near.length > 1) return { student: null, status: "ambiguous", message: `${near.length} students have a similar name. Choose the right one.` };
      }
    }
    return { student: null, status: "unmatched", message: "No student in the portal has this name. Choose the student, or enrol them." };
  };
  const plan: IdPlanRow[] = rows.map((row) => (row.problem
    ? { ...row, status: "problem", student: null, message: row.problem }
    : { ...row, ...findFor(row) }));
  // One student, one admission number: two lines pointing at the same student need a person to choose.
  const count = new Map<number, number>();
  for (const p of plan) if (p.student && (p.status === "match" || p.status === "close" || p.status === "already")) count.set(p.student.id, (count.get(p.student.id) ?? 0) + 1);
  return plan.map((p) => (p.student && (p.status === "match" || p.status === "close") && (count.get(p.student.id) ?? 0) > 1
    ? { ...p, status: "ambiguous", student: null, message: `Two lines on the list fit ${p.student.name}. Choose the right student.` }
    : p));
}
