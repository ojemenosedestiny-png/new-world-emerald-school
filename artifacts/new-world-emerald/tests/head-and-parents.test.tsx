import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParentChild, ParentChildProgress, ParentLinks, SchoolEmailWorkspace } from "@workspace/api-client-react";
import { SchoolEmail } from "../src/portal/messaging/SchoolEmail";
import { ParentLinksPanel, parentLink } from "../src/portal/manage/ParentLinksPanel";
import { ChildProgressView } from "../src/portal/parents/ChildProgress";

const api = vi.hoisted(() => ({ send: vi.fn(), links: vi.fn(async () => ({ message: "Saved." })), workspace: null as unknown, linksData: null as unknown, progress: null as unknown }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetSchoolEmail: () => ({ isLoading: false, isError: false, data: api.workspace, refetch: vi.fn() }),
  useGetSchoolEmailMessage: () => ({ isLoading: false, isError: false, data: undefined, refetch: vi.fn() }),
  useSendSchoolEmail: () => ({ mutateAsync: api.send, isPending: false }),
  useGetParentLinks: () => ({ isLoading: false, isError: false, data: api.linksData, refetch: vi.fn() }),
  useManageParentLinks: () => ({ mutateAsync: api.links, isPending: false }),
  useGetParentChildProgress: () => ({ isLoading: false, isError: false, data: api.progress, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const workspace: SchoolEmailWorkspace = {
  sender: { email: "head@school.test", role: "head", name: "Grace Okafor" }, emailReady: true, dailyLimit: 500, sentToday: 10,
  classes: [{ id: 1, name: "JSS 1" }, { id: 2, name: "Year 3" }],
  people: [
    { kind: "teacher", email: "musa@school.test", name: "Mr Musa", detail: "JSS 1", classIds: [1] },
    { kind: "teacher", email: "ngozi@school.test", name: "Mrs Ngozi", detail: "", classIds: [] },
    { kind: "parent", email: "mum@home.test", name: "Parent of Ada Obi and Chi Obi", detail: "Ada Obi (JSS 1), Chi Obi (Year 3)", classIds: [1, 2] },
    { kind: "parent", email: "dad@home.test", name: "Parent of Ben Eze", detail: "Ben Eze (Year 3)", classIds: [2] },
  ],
  history: [{ id: 5, subject: "Staff meeting", body: "Monday 8am", senderName: "Ade Bello", senderEmail: "d@school.test", senderRole: "director", recipients: 3, sent: 2, failed: 1, status: "done", createdAt: "2026-11-07T09:00:00Z", finishedAt: "2026-11-07T09:01:00Z" }],
};

describe("emails from the Director and Head of School", () => {
  it("picks people one by one, everyone, or a class's parents, previews the letter, and sends private copies", async () => {
    api.workspace = workspace;
    api.send.mockResolvedValue({ ...workspace.history[0], id: 6, recipients: 3, status: "sending" });
    render(wrap(<SchoolEmail />));
    expect((screen.getByTestId("button-send-email") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("check-teacher-musa@school.test"));
    fireEvent.click(screen.getByTestId("tab-email-parent"));
    fireEvent.change(screen.getByTestId("select-email-class"), { target: { value: "2" } });
    expect(screen.getByTestId("text-email-recipient-count").textContent).toBe("3 people chosen: 1 teacher, 2 parents");
    fireEvent.change(screen.getByTestId("input-email-subject"), { target: { value: "PTA meeting" } });
    fireEvent.change(screen.getByTestId("input-email-message"), { target: { value: "We meet on Friday.\n\nPlease come." } });
    const preview = screen.getByTestId("email-preview");
    expect(within(preview).getByText("Dear Mr Musa,")).toBeTruthy();
    expect(within(preview).getByText("Please come.")).toBeTruthy();
    expect(preview.textContent).toContain("Head of School, New World Emerald Private School");
    fireEvent.click(screen.getByTestId("button-send-email"));
    await waitFor(() => expect(api.send).toHaveBeenCalledWith({ data: { subject: "PTA meeting", message: "We meet on Friday.\n\nPlease come.", recipients: [
      { kind: "teacher", email: "musa@school.test" }, { kind: "parent", email: "mum@home.test" }, { kind: "parent", email: "dad@home.test" },
    ] } }));
    expect(within(screen.getByTestId("table-sent-emails")).getByText("(1 failed)")).toBeTruthy();
  });

  it("selects everyone and stops at today's allowance", () => {
    api.workspace = { ...workspace, dailyLimit: 11 };
    render(wrap(<SchoolEmail />));
    fireEvent.click(screen.getByTestId("button-select-all-teacher"));
    fireEvent.change(screen.getByTestId("input-email-subject"), { target: { value: "Hi" } });
    fireEvent.change(screen.getByTestId("input-email-message"), { target: { value: "Hello" } });
    expect(screen.getByText("Only 1 more emails can go out today.")).toBeTruthy();
    expect((screen.getByTestId("button-send-email") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the office links parents to children", () => {
  const links: ParentLinks = {
    parents: [{ email: "mum@home.test", children: [{ id: 1, studentId: "S1", name: "Ada Obi", className: "JSS 1", slot: "first" }] }],
    students: [{ id: 1, studentId: "S1", name: "Ada Obi", className: "JSS 1", parents: ["mum@home.test"] }, { id: 2, studentId: "S2", name: "Chi Obi", className: "Year 3", parents: [] }],
  };
  it("finds a child, links them to the parent's email, and gives the parent a sign-in link", async () => {
    api.linksData = links;
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(wrap(<ParentLinksPanel />));
    fireEvent.change(screen.getByTestId("input-link-email"), { target: { value: "Dad@Home.test" } });
    fireEvent.change(screen.getByTestId("input-link-child"), { target: { value: "obi" } });
    fireEvent.click(screen.getByTestId("button-link-2"));
    await waitFor(() => expect(api.links).toHaveBeenCalledWith({ data: { action: "link", email: "dad@home.test", studentId: 2 } }));
    fireEvent.click(screen.getByTestId("button-copy-parent-link"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(parentLink("dad@home.test")));
    expect(parentLink("dad@home.test")).toMatch(/\/sign-in\?returnTo=parents&email=dad%40home.test$/);
    fireEvent.click(screen.getByTestId("button-email-parent-link"));
    await waitFor(() => expect(api.links).toHaveBeenCalledWith({ data: { action: "invite", email: "dad@home.test" } }));
  });
});

describe("parents see each child's progress", () => {
  it("shows report cards, results (scores only once released), attendance, homework and timetables", () => {
    api.progress = {
      child: { id: 1, name: "Ada Obi", studentId: "S1", className: "JSS 1" }, reports: [], upcoming: [{ examId: 9, title: "Science quiz", subject: "Basic Science", startsAt: "2026-11-12T08:00:00Z", endsAt: "2026-11-12T09:00:00Z" }],
      results: [
        { examId: 1, title: "Mid-term test", subject: "Mathematics", date: "2026-11-02T08:00:00Z", status: "marked", released: true, score: 16, totalMarks: 20 },
        { examId: 2, title: "Spelling", subject: "English", date: "2026-11-03T08:00:00Z", status: "submitted", released: false, score: null, totalMarks: 10 },
      ],
      attendance: { since: "2026-05-11", totals: { present: 18, late: 1, absent: 1, excused: 0, daysPresent: 19, daysRecorded: 20 }, records: [{ date: "2026-11-06", status: "absent", note: "Sick" }] },
      homework: [{ id: 3, subject: "Mathematics", title: "Fractions", instructions: "", dueAt: "2026-11-01T08:00:00Z", maxScore: 10, fileId: "sheet-1", submission: { id: 1, text: "", imageIds: [], submittedAt: "2026-10-31T10:00:00Z", late: false, score: 8, feedback: "Well done", markedAt: "2026-11-01T12:00:00Z" } }],
      timetables: [{ id: 4, title: "Autumn Term exam timetable", kind: "exam", classIds: [], classNames: [], fileId: "tt-1", fileType: "pdf", published: true, createdBy: "officer@school.test", updatedAt: "2026-11-05T09:00:00Z" }],
    } satisfies ParentChildProgress;
    const children = [{ id: 1, name: "Ada Obi", studentId: "S1", photoImageId: null }, { id: 2, name: "Chi Obi", studentId: "S2", photoImageId: null }] as unknown as ParentChild[];
    const select = vi.fn();
    render(wrap(<ChildProgressView children={children} selected={1} onSelect={select} />));
    expect(screen.getByText("95%")).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByText(/No report cards yet/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("tab-progress-results"));
    const table = screen.getByTestId("table-child-results");
    expect(within(table).getByText("16")).toBeTruthy();
    expect(within(table).getByText("Waiting for the teacher")).toBeTruthy();
    expect(screen.getByText("Science quiz")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tab-progress-attendance"));
    expect(within(screen.getByTestId("list-child-attendance")).getByText("Absent")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tab-progress-homework"));
    expect(within(screen.getByTestId("child-homework-3")).getByText("8 / 10")).toBeTruthy();
    expect(screen.getByText("Well done")).toBeTruthy();
    expect(screen.getByTestId("link-child-homework-sheet-3").getAttribute("href")).toMatch(/\/api\/portal\/files\/sheet-1$/);
    fireEvent.click(screen.getByTestId("tab-progress-timetables"));
    const card = screen.getByTestId("card-timetable-4");
    expect(within(card).getByText("Exam timetable")).toBeTruthy();
    expect(card.textContent).toContain("Whole school");
    expect(within(card).getByTestId("link-timetable-4").getAttribute("href")).toMatch(/\/api\/portal\/files\/tt-1$/);
    fireEvent.click(screen.getByTestId("button-progress-child-2"));
    expect(select).toHaveBeenCalledWith(2);
  });
});
