import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalManagement, PrincipalOverview } from "@workspace/api-client-react";
import { ClassesView } from "../src/portal/principal/PrincipalViews";
import { armName, groupClasses, yearGroup } from "../src/portal/principal/groups";
import { MyTeaching } from "../src/portal/manage/Dashboard";

const api = vi.hoisted(() => ({ manage: vi.fn(async () => ({ message: "Saved." })) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManagePrincipal: () => ({ mutateAsync: api.manage, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("year groups and arms", () => {
  it("gathers the arms of a year group and orders the school from Year 1 to SS 3", () => {
    expect(yearGroup("Year 11 Amber")).toEqual({ key: "year 11", label: "Year 11", order: 11 });
    expect(yearGroup("JSS 1A").label).toBe("JSS 1");
    expect(yearGroup("SS 2").order).toBe(11);
    expect(armName("Year 11 Chrysolite")).toBe("Chrysolite");
    expect(armName("JSS 2")).toBe("");
    const groups = groupClasses([{ name: "Year 11 Jade" }, { name: "Year 7" }, { name: "Year 11 Amber" }, { name: "Year 11 Chrysolite" }]);
    expect(groups.map((g) => [g.group.label, g.classes.map((c) => c.name)])).toEqual([["Year 11", ["Year 11 Amber", "Year 11 Chrysolite", "Year 11 Jade"]], ["Year 7", ["Year 7"]]]);
  });
});

const sub = (id: number, name: string, teacherId: number | null) => ({ id, name, teacherId, teacherName: teacherId === 7 ? "Mr Musa" : teacherId === 8 ? "Mrs Ngozi" : null });
const data: PrincipalOverview = {
  today: "2026-11-04",
  classes: [
    { id: 1, name: "Year 11 Amber", students: 20, teachers: [{ id: 7, name: "Mr Musa" }], subjects: [sub(11, "Physics", 7), sub(12, "Chemistry", null)] },
    { id: 2, name: "Year 11 Jade", students: 18, teachers: [], subjects: [sub(21, "Physics", 8), sub(22, "Chemistry", null)] },
    { id: 3, name: "Year 11 Chrysolite", students: 22, teachers: [{ id: 8, name: "Mrs Ngozi" }], subjects: [sub(31, "Physics", 7)] },
    { id: 4, name: "Year 7", students: 30, teachers: [{ id: 8, name: "Mrs Ngozi" }], subjects: [] },
  ],
  teachers: [
    { id: 7, name: "Mr Musa", email: "m@x", classIds: [1], photoFileId: null, subjectCount: 2, inSection: true },
    { id: 8, name: "Mrs Ngozi", email: "n@x", classIds: [3, 4], photoFileId: null, subjectCount: 1, inSection: true },
  ],
};

describe("principal: classes by year group", () => {
  it("shows a year group's arms together and sets a subject's teacher in every arm at once", async () => {
    render(wrap(<ClassesView data={data} />));
    const year11 = screen.getByTestId("year-group-year-11");
    expect(within(year11).getByText("3 arms: Amber, Chrysolite, Jade · 60 students")).toBeTruthy();
    const physics = within(year11).getByTestId("select-group-subject-physics") as HTMLSelectElement;
    expect(physics.value).toBe("mixed");
    fireEvent.change(physics, { target: { value: "7" } });
    await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "setGroupSubjectTeacher", classId: 1, classIds: [1, 3, 2], subjectName: "Physics", teacherId: 7 } }));
    // Chemistry is offered in two of the three arms, and only those are changed.
    expect(within(year11).getByText("2 of 3 arms")).toBeTruthy();
    expect((within(year11).getByTestId("select-group-subject-chemistry") as HTMLSelectElement).value).toBe("");
  });

  it("sorts in school order by default, or puts classes needing teachers first", () => {
    render(wrap(<ClassesView data={data} />));
    const order = () => screen.getAllByTestId(/^year-group-/).map((g) => g.getAttribute("data-testid"));
    expect(order()).toEqual(["year-group-year-7", "year-group-year-11"]);
    fireEvent.change(screen.getByTestId("select-sort-classes"), { target: { value: "attention" } });
    expect(order()).toEqual(["year-group-year-11", "year-group-year-7"]);
    fireEvent.change(screen.getByTestId("select-sort-classes"), { target: { value: "students" } });
    expect(order()).toEqual(["year-group-year-11", "year-group-year-7"]);
  });
});

describe("teacher: my teaching", () => {
  it("lists the classes a teacher leads and the subjects they teach in each class", () => {
    const go = vi.fn();
    const teaching: NonNullable<PortalManagement["teaching"]> = {
      classTeacherOf: [{ id: 1, name: "Year 11 Amber" }],
      subjects: [{ subjectId: 11, subject: "Physics", classId: 1, className: "Year 11 Amber" }, { subjectId: 31, subject: "Physics", classId: 3, className: "Year 11 Chrysolite" }, { subjectId: 12, subject: "Chemistry", classId: 1, className: "Year 11 Amber" }],
    };
    render(<MyTeaching teaching={teaching} onGo={go} />);
    const panel = screen.getByTestId("panel-my-teaching");
    expect(within(panel).getByText("Year 11 Amber", { selector: "p" })).toBeTruthy();
    expect(within(panel).getAllByText("Physics")).toHaveLength(2);
    expect(within(panel).getByText("Chemistry")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-my-teaching-scores"));
    expect(go).toHaveBeenCalledWith("reports");
  });

  it("explains when nothing is assigned yet", () => {
    render(<MyTeaching teaching={{ classTeacherOf: [], subjects: [] }} onGo={vi.fn()} />);
    expect(screen.getByText("No class yet")).toBeTruthy();
    expect(screen.getByText(/The principal assigns subject teachers/)).toBeTruthy();
  });
});
