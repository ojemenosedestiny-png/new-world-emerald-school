import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MyMessages, PortalDashboard } from "@workspace/api-client-react";
import { StudentMessages } from "../src/portal/StudentMessages";
import { MessagesPanel } from "../src/portal/manage/MessagesPanel";
import { studentNotifications } from "../src/portal/notifications";

const at = new Date().toISOString();
const api = vi.hoisted(() => ({
  mine: null as unknown,
  threads: [] as unknown[],
  thread: null as unknown,
  send: vi.fn(),
  read: vi.fn(),
  reply: vi.fn(),
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetMyMessages: () => ({ data: api.mine, isLoading: false, isError: false }),
  useSendMyMessage: () => ({ mutateAsync: api.send, isPending: false }),
  useMarkMyMessagesRead: () => ({ mutate: api.read, isPending: false }),
  useListMessageThreads: () => ({ data: api.threads, isLoading: false, isError: false }),
  useGetMessageThread: () => ({ data: api.thread, isLoading: false, isError: false }),
  useReplyMessageThread: () => ({ mutateAsync: api.reply, isPending: false }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const reply = { id: 2, fromStaff: true, senderName: "School office", body: "Friday at 2pm", createdAt: at, read: false };
const mine: MyMessages = { threads: [
  { channel: "class", title: "Class teacher (JSS 1)", unread: 0, messages: [] },
  { channel: "office", title: "School office", unread: 1, messages: [{ id: 1, fromStaff: false, senderName: "Ada Obi", body: "When is the PTA meeting?", createdAt: at, read: true }, reply] },
] };

describe("student messages", () => {
  it("sends to the class teacher, and marks office replies read when opened", async () => {
    api.mine = mine;
    api.send.mockResolvedValue(mine);
    render(wrap(<StudentMessages />));
    expect(screen.getByTestId("badge-thread-office").textContent).toBe("1");
    expect(api.read).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("input-chat"), { target: { value: " I was sick on Monday " } });
    fireEvent.keyDown(screen.getByTestId("input-chat"), { key: "Enter" });
    await waitFor(() => expect(api.send).toHaveBeenCalledWith({ data: { channel: "class", body: "I was sick on Monday" } }));
    await waitFor(() => expect((screen.getByTestId("input-chat") as HTMLTextAreaElement).value).toBe(""));
    fireEvent.click(screen.getByTestId("tab-thread-office"));
    expect(screen.getByTestId("message-2").textContent).toContain("Friday at 2pm");
    await waitFor(() => expect(api.read).toHaveBeenCalledWith({ data: { channel: "office" } }, expect.anything()));
  });
  it("puts unread replies in the bell", () => {
    const list = studentNotifications({ exams: [], attempts: [], notices: [], materials: [] } as unknown as PortalDashboard, undefined, {}, Date.now(), [], [], mine);
    expect(list.map((n) => [n.key, n.section])).toEqual([["message:2", "messages"]]);
    expect(list[0].title).toBe("New message: School office");
  });
});

describe("staff inbox", () => {
  it("lists conversations, filters unread, and replies in a thread", async () => {
    api.threads = [
      { studentId: 7, studentName: "Ada Obi", studentCode: "NWE/2026/00001", className: "JSS 1", channel: "office", lastBody: "When is the PTA meeting?", lastAt: at, lastFromStaff: false, unread: 1 },
      { studentId: 8, studentName: "Bayo Ade", studentCode: "NWE/2026/00002", className: "JSS 1", channel: "class", lastBody: "Thank you", lastAt: at, lastFromStaff: true, unread: 0 },
    ];
    api.thread = { studentId: 7, studentName: "Ada Obi", studentCode: "NWE/2026/00001", className: "JSS 1", channel: "office", messages: mine.threads[1].messages };
    api.reply.mockResolvedValue(api.thread);
    render(wrap(<MessagesPanel isAdmin />));
    expect(screen.getByTestId("thread-8-class").textContent).toContain("You: Thank you");
    fireEvent.click(screen.getByTestId("filter-messages-unread"));
    expect(screen.queryByTestId("thread-8-class")).toBeNull();
    fireEvent.click(screen.getByTestId("thread-7-office"));
    expect(screen.getByTestId("text-thread-student").textContent).toBe("Ada Obi");
    fireEvent.change(screen.getByTestId("input-chat"), { target: { value: "Friday at 2pm" } });
    fireEvent.click(screen.getByTestId("button-chat-send"));
    await waitFor(() => expect(api.reply).toHaveBeenCalledWith({ studentId: 7, channel: "office", data: { body: "Friday at 2pm" } }));
    fireEvent.click(screen.getByTestId("button-thread-back"));
    expect(screen.getByTestId("list-threads")).toBeTruthy();
  });
  it("teachers see only the simple filters", () => {
    api.threads = [];
    render(wrap(<MessagesPanel isAdmin={false} />));
    expect(screen.queryByTestId("filter-messages-office")).toBeNull();
    expect(screen.getByText("No messages yet")).toBeTruthy();
  });
});
