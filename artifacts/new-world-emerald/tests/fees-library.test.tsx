import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FeeStatement, PortalDashboard } from "@workspace/api-client-react";
import { FeeStatementView, naira } from "../src/portal/FeeStatement";
import { StudentLibrary, libraryGroups } from "../src/portal/StudentLibrary";

afterEach(cleanup);

const statement: FeeStatement = {
  studentName: "Ada Obi", studentId: "NWE/2026/00001", className: "JSS 1",
  items: [
    { key: "class-1", kind: "class", description: "Tuition", term: "First Term", academicYear: "2026/2027", amountKobo: 150_000_00, reference: null, status: "paid" },
    { key: "charge-4", kind: "individual", description: "Excursion", term: "First Term", academicYear: "2026/2027", amountKobo: 10_000_00, reference: "NWE-FEE-4", status: "due" },
  ],
  totals: { totalKobo: 160_000_00, paidKobo: 150_000_00, pendingKobo: 0, outstandingKobo: 10_000_00 },
  payments: [{ reference: "NWE-PAY-1", description: "", amountKobo: 150_000_00, status: "confirmed", createdAt: new Date().toISOString() }],
};

describe("fee statement", () => {
  it("shows totals, each fee's state and how to pay the balance", () => {
    render(<FeeStatementView s={statement} />);
    expect(screen.getByTestId("fee-total-balance").textContent).toBe(naira(10_000_00));
    expect(screen.getByTestId("fee-item-class-1").textContent).toContain("Paid");
    expect(screen.getByTestId("fee-item-charge-4").textContent).toContain("NWE-FEE-4");
    expect(screen.getByTestId("fee-item-charge-4").textContent).toContain("Due");
    expect(screen.getByTestId("list-fee-payments").textContent).toContain("Confirmed");
    expect(screen.getByTestId("link-pay-fees").getAttribute("href")).toContain("/commerce");
  });
  it("hides the pay link for the office and when nothing is owed", () => {
    render(<FeeStatementView s={statement} forOffice />);
    expect(screen.queryByTestId("link-pay-fees")).toBeNull();
    cleanup();
    render(<FeeStatementView s={{ ...statement, totals: { ...statement.totals, outstandingKobo: 0 } }} />);
    expect(screen.queryByTestId("link-pay-fees")).toBeNull();
  });
  it("explains an empty statement", () => {
    render(<FeeStatementView s={{ ...statement, items: [], payments: [] }} />);
    expect(screen.getByText("No fees listed yet")).toBeTruthy();
  });
});

const materials = [
  { id: 1, title: "Fractions", subject: "Mathematics", body: "Adding fractions", classId: 1, fileId: null, published: true },
  { id: 2, title: "Algebra basics", subject: "Mathematics", body: "Letters for numbers", classId: 1, fileId: "f1", published: true },
  { id: 3, title: "Parts of speech", subject: "English", body: "Nouns and verbs", classId: 1, fileId: null, published: true },
] as unknown as PortalDashboard["materials"];

describe("library", () => {
  it("groups by subject and filters by subject and search", () => {
    expect(libraryGroups(materials, "", "").map(([s, items]) => [s, items.length])).toEqual([["English", 1], ["Mathematics", 2]]);
    expect(libraryGroups(materials, "Mathematics", "letters").map(([, items]) => items.map((m) => m.id))).toEqual([[2]]);
    expect(libraryGroups(materials, "", "nouns")[0][0]).toBe("English");
  });
  it("lets a student narrow the notes", () => {
    render(<StudentLibrary materials={materials} />);
    fireEvent.click(screen.getByTestId("chip-subject-English"));
    expect(screen.queryByTestId("card-material-1")).toBeNull();
    expect(screen.getByTestId("card-material-3")).toBeTruthy();
    fireEvent.click(screen.getByTestId("chip-subject-all"));
    fireEvent.change(screen.getByTestId("input-library-search"), { target: { value: "zzz" } });
    expect(screen.getByTestId("text-library-empty")).toBeTruthy();
  });
});
