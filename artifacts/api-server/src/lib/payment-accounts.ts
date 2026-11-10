import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  classFeeSchedulesTable, db, examRegistrationSettings, examRegistrations, feePaymentReportsTable, paymentAccounts, portalClasses, portalTerms,
  schoolCommerceSettingsTable, type ExamRegistrationSettingsRecord,
} from "@workspace/db";

export type Purpose = "school_fees" | "exam_registration";
export type AccountDetails = { bankName: string; accountName: string; accountNumber: string };

/**
 * The account a payer should transfer into: an active account for this purpose and session, else one for every
 * session, else (for schools that set accounts on the website before) a matching website account.
 */
export async function accountFor(purpose: Purpose, academicYear: string): Promise<AccountDetails | null> {
  const rows = await db.select().from(paymentAccounts).where(and(eq(paymentAccounts.purpose, purpose), eq(paymentAccounts.active, true))).orderBy(desc(paymentAccounts.updatedAt));
  const year = academicYear.trim();
  const pick = rows.find((a) => a.academicYear === year) ?? rows.find((a) => !a.academicYear);
  if (pick) return { bankName: pick.bankName, accountName: pick.accountName, accountNumber: pick.accountNumber };
  const [settings] = await db.select({ bankAccounts: schoolCommerceSettingsTable.bankAccounts }).from(schoolCommerceSettingsTable).limit(1);
  const site = settings?.bankAccounts ?? [];
  const exam = (label: string) => /waec|neco|exam/i.test(label);
  const fallback = purpose === "exam_registration" ? site.find((a) => exam(a.label)) : site.find((a) => !exam(a.label));
  return fallback ? { bankName: fallback.bankName, accountName: fallback.accountName, accountNumber: fallback.accountNumber } : null;
}

/** Academic sessions in use anywhere (report terms, fee schedules, WAEC/NECO), newest first. */
export async function knownSessions() {
  const [terms, fees, exams] = await Promise.all([
    db.selectDistinct({ s: portalTerms.session }).from(portalTerms),
    db.selectDistinct({ s: classFeeSchedulesTable.academicYear }).from(classFeeSchedulesTable),
    db.select({ s: examRegistrationSettings.academicYear }).from(examRegistrationSettings),
  ]);
  return [...new Set([...terms, ...fees, ...exams].map((r) => r.s.trim()).filter(Boolean))].sort((a, b) => b.localeCompare(a));
}

/** The receipt number for a confirmed transfer: stable, unique and readable. */
export const receiptNumber = (id: number, confirmedAt: Date) => `NWE/RCT/${confirmedAt.getFullYear()}/${String(id).padStart(5, "0")}`;

type Report = typeof feePaymentReportsTable.$inferSelect;
/** A reported transfer as the portal shows it. */
export function transferView(r: Report) {
  const confirmedAt = r.status === "confirmed" ? (r.confirmedAt ?? r.updatedAt) : null;
  return {
    id: r.id, reference: r.reference, receiptNumber: confirmedAt ? receiptNumber(r.id, confirmedAt) : null,
    purpose: (r.purpose === "exam_registration" ? "exam_registration" : "school_fees") as Purpose,
    studentName: r.studentName, studentIdentifier: r.studentIdentifier, className: r.className, description: r.description || "School fees",
    term: r.term, academicYear: r.academicYear, amountKobo: r.amountKobo, status: r.status, officeNote: r.officeNote ?? null,
    proofImageId: r.proofImageId ?? null, transferReference: r.transferReference ?? null, payer: r.parentEmail || r.guardianEmail,
    account: r.accountNumber ? { bankName: r.accountBank ?? "", accountName: r.accountName ?? "", accountNumber: r.accountNumber } : null,
    createdAt: r.createdAt.toISOString(), confirmedAt: confirmedAt?.toISOString() ?? null, confirmedBy: r.confirmedBy ?? null,
  };
}

/** WAEC/NECO fee state for a student in a session: paid once a transfer is confirmed, pending while one is checked. */
export async function examFeeStatus(studentId: number, academicYear: string): Promise<"due" | "pending" | "paid"> {
  const rows = await db.select({ status: feePaymentReportsTable.status }).from(feePaymentReportsTable)
    .where(and(eq(feePaymentReportsTable.purpose, "exam_registration"), eq(feePaymentReportsTable.studentPortalId, studentId), eq(feePaymentReportsTable.academicYear, academicYear)));
  if (rows.some((r) => r.status === "confirmed")) return "paid";
  if (rows.some((r) => r.status === "reported" || r.status === "payment_requested")) return "pending";
  return "due";
}

/** The open WAEC/NECO registration a student's class takes part in (newest session first), if any. */
export async function openRegistrationFor(classId: number): Promise<ExamRegistrationSettingsRecord | null> {
  const open = await db.select().from(examRegistrationSettings).where(eq(examRegistrationSettings.open, true)).orderBy(desc(examRegistrationSettings.academicYear));
  return open.find((s) => s.classIds.includes(classId)) ?? null;
}

/** WAEC/NECO fees for a parent's children who are in an open registration with a fee. */
export async function examFeesFor(children: { id: number; name: string; studentId: string; classId: number }[]) {
  const out = [];
  for (const c of children) {
    const s = await openRegistrationFor(c.classId);
    if (!s || s.feeKobo <= 0) continue;
    const [[cls], [form]] = await Promise.all([
      db.select({ name: portalClasses.name }).from(portalClasses).where(eq(portalClasses.id, c.classId)),
      db.select({ status: examRegistrations.status }).from(examRegistrations).where(and(eq(examRegistrations.studentId, c.id), eq(examRegistrations.academicYear, s.academicYear))),
    ]);
    out.push({
      studentId: c.id, studentName: c.name, studentCode: c.studentId, className: cls?.name ?? "", academicYear: s.academicYear, title: s.title,
      amountKobo: s.feeKobo, status: await examFeeStatus(c.id, s.academicYear), itemKey: `exam-${s.academicYear}`, formStatus: form?.status ?? "none",
    });
  }
  return out;
}

/** Transfers reported for a family: by this parent, or for any of their children. */
export async function familyTransfers(email: string, children: { id: number; studentId: string }[]) {
  const codes = children.map((c) => c.studentId.trim().toUpperCase().replace(/\s+/g, ""));
  const rows = await db.select().from(feePaymentReportsTable).where(or(
    eq(feePaymentReportsTable.parentEmail, email),
    children.length ? inArray(feePaymentReportsTable.studentPortalId, children.map((c) => c.id)) : sql`false`,
    codes.length ? sql`upper(regexp_replace(${feePaymentReportsTable.studentIdentifier}, '\\s', '', 'g')) in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})` : sql`false`,
  )).orderBy(desc(feePaymentReportsTable.createdAt)).limit(100);
  return rows.map(transferView);
}
