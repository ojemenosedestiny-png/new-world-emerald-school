import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { MyMessages } from "@workspace/api-client-react";
import { StudentMessages } from "../src/portal/StudentMessages";
import { MessagesPanel } from "../src/portal/manage/MessagesPanel";

const at = new Date().toISOString();
const api = vi.hoisted(() => ({ mine: null as unknown, threads: [] as unknown[], priv: null as unknown, send: vi.fn(), read: vi.fn(), reply: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetMyMessages: () => ({ data: api.mine, isLoading: false, isError: false }),
  useSendMyMessage: () => ({ mutateAsync: api.send, isPending: false }),
  useMarkMyMessagesRead: () => ({ mutate: api.read, isPending: false }),
  useListMessageThreads: () => ({ data: api.threads, isLoading: false, isError: false }),
  useGetMessageThread: () => ({ data: null, isLoading: false, isError: false }),
  useReplyMessageThread: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGetPrivateMessageThread: () => ({ data: api.priv, isLoading: false, isError: false }),
  useReplyPrivateMessageThread: () => ({ mutateAsync: api.reply, isPending: false }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mine: MyMessages = {
  threads: [
    { channel: "class", title: "Class teacher (JSS 1A)", unread: 0, messages: [], teacherId: null, closed: false },
    { channel: "office", title: "School office", unread: 0, messages: [], teacherId: null, closed: false },
    { channel: "teacher", title: "Mrs Ngozi", unread: 1, teacherId: 5, closed: false, messages: [{ id: 9, fromStaff: true, senderName: "Mrs Ngozi", body: "Come at break.", createdAt: at, read: false }] },
  ],
  teachers: [
    { id: 4, name: "Mr Musa", title: "", photoId: null, classTeacher: true, subjects: [] },
    { id: 5, name: "Mrs Ngozi", title: "", photoId: null, classTeacher: false, subjects: ["Mathematics"] },
    { id: 6, name: "Mr Femi", title: "", photoId: null, classTeacher: false, subjects: ["Basic Science", "Agric"] },
  ],
};

it("a student picks one teacher and writes to them privately", async () => {
  api.mine = mine;
  api.send.mockResolvedValue(mine);
  render(wrap(<StudentMessages />));
  expect(screen.getByTestId("badge-thread-teacher-5").textContent).toBe("1");
  fireEvent.click(screen.getByTestId("button-new-teacher-message"));
  expect(screen.getByTestId("pick-teacher-4").textContent).toContain("Class teacher");
  fireEvent.change(screen.getByTestId("input-teacher-search"), { target: { value: "science" } });
  expect(screen.queryByTestId("pick-teacher-4")).toBeNull();
  fireEvent.click(screen.getByTestId("pick-teacher-6"));
  expect(screen.getByTestId("text-chat-privacy").textContent).toContain("Private: only Mr Femi can read and answer this");
  fireEvent.click(screen.getByText("I need help with my assignment."));
  fireEvent.click(screen.getByTestId("button-chat-send"));
  await waitFor(() => expect(api.send).toHaveBeenCalledWith({ data: { channel: "teacher", body: "I need help with my assignment.", teacherId: 6 } }));

  fireEvent.click(screen.getByTestId("tab-thread-teacher-5"));
  expect(screen.getByTestId("message-9").textContent).toContain("Come at break.");
  await waitFor(() => expect(api.read).toHaveBeenCalledWith({ data: { channel: "teacher", teacherId: 5 } }, expect.anything()));
});

it("the staff inbox marks private conversations, and the office reads them without answering", async () => {
  api.threads = [
    { studentId: 7, studentName: "Ada Obi", studentCode: "NWE/1", className: "JSS 1A", channel: "teacher", teacherId: 5, teacherName: "Mrs Ngozi", lastBody: "Please explain fractions", lastAt: at, lastFromStaff: false, unread: 1 },
    { studentId: 8, studentName: "Bayo Ade", studentCode: "NWE/2", className: "JSS 1A", channel: "class", teacherId: null, teacherName: "", lastBody: "Thanks", lastAt: at, lastFromStaff: true, unread: 0 },
  ];
  api.priv = { studentId: 7, studentName: "Ada Obi", studentCode: "NWE/1", className: "JSS 1A", channel: "teacher", teacherId: 5, teacherName: "Mrs Ngozi", canReply: false, messages: [] };
  render(wrap(<MessagesPanel isAdmin />));
  expect(screen.getByTestId("thread-7-teacher-5").textContent).toContain("Private to Mrs Ngozi");
  fireEvent.click(screen.getByTestId("filter-messages-private"));
  expect(screen.queryByTestId("thread-8-class")).toBeNull();
  fireEvent.click(screen.getByTestId("thread-7-teacher-5"));
  expect(screen.getByTestId("text-thread-private").textContent).toContain("Private to Mrs Ngozi");
  expect(screen.getByTestId("text-thread-readonly").textContent).toContain("Only Mrs Ngozi can answer it");
  expect(screen.queryByTestId("input-chat")).toBeNull();
  cleanup();

  api.priv = { ...(api.priv as object), canReply: true };
  api.reply.mockResolvedValue(api.priv);
  render(wrap(<MessagesPanel isAdmin={false} />));
  fireEvent.click(screen.getByTestId("thread-7-teacher-5"));
  fireEvent.change(screen.getByTestId("input-chat"), { target: { value: "Come to my desk at break." } });
  fireEvent.click(screen.getByTestId("button-chat-send"));
  await waitFor(() => expect(api.reply).toHaveBeenCalledWith({ studentId: 7, teacherId: 5, data: { body: "Come to my desk at break." } }));
});
