import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel, Rich } from "../src/portal/assistant/AssistantPanel";

const api = vi.hoisted(() => ({ home: null as unknown }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetAssistant: () => ({ isLoading: false, isError: false, data: api.home, refetch: vi.fn() }),
  useGetAssistantConversation: () => ({ isLoading: false, data: undefined }),
  useDeleteAssistantConversation: () => ({ mutateAsync: vi.fn() }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => cleanup());

describe("staff AI assistant", () => {
  it("renders answers as safe formatted text, never raw HTML", () => {
    const { container } = render(<Rich text={"# Objectives\n- Define **photosynthesis**\n- Name `chlorophyll`\n1. First\n2. Second\n<img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("strong")?.textContent).toBe("photosynthesis");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("says it is off until the key is set", () => {
    api.home = { enabled: false, allowed: true, dailyLimit: 40, usedToday: 0, conversations: [] };
    render(wrap(<AssistantPanel />));
    expect(screen.getByText("The AI assistant is not switched on yet")).toBeTruthy();
  });

  it("shows past chats and the questions left today, and stops at the limit", () => {
    api.home = { enabled: true, allowed: true, dailyLimit: 3, usedToday: 3, conversations: [{ id: 4, title: "JSS 2 photosynthesis", updatedAt: "2026-11-10T09:00:00Z" }] };
    render(wrap(<AssistantPanel />));
    expect(screen.getByTestId("button-chat-4").textContent).toBe("JSS 2 photosynthesis");
    expect(screen.getByTestId("text-assistant-left").textContent).toContain("0 of 3");
    expect((screen.getByTestId("input-assistant") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
