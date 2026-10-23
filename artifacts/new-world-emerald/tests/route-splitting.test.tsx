import { lazy } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppRoutes } from "@/AppRoutes";
import { RouteBoundary } from "@/components/RouteBoundary";

const loaded = vi.hoisted(() => vi.fn());
vi.mock("@/pages/Home", () => ({
  default: () => <><h1>Homepage</h1><Link href="/admin">Office</Link></>,
}));
vi.mock("@/pages/Admin", () => {
  loaded("admin");
  return { default: () => <h1>Admin</h1> };
});
vi.mock("@/pages/Account", () => {
  loaded("account");
  return { default: () => <h1>Account</h1> };
});
vi.mock("@/pages/SchoolCommerce", () => {
  loaded("commerce");
  return { default: () => <h1>Commerce</h1> };
});
vi.mock("@/pages/SchoolSignIn", () => {
  loaded("sign-in");
  return { SchoolSignIn: ({ signup = false }: { signup?: boolean }) =>
    <h1>{signup ? "Sign up" : "Sign in"}</h1> };
});
vi.mock("@/pages/not-found", () => ({
  default: () => <h1>Not found</h1>,
}));

afterEach(cleanup);

function openRoute(path: string, base = "") {
  const location = memoryLocation({ path });
  render(<Router hook={location.hook} base={base}><AppRoutes /></Router>);
  return location;
}

describe("on-demand routes", () => {
  it("renders the homepage without importing office, account, sign-in or commerce pages", () => {
    openRoute("/");
    expect(screen.getByText("Homepage")).toBeTruthy();
    expect(loaded).not.toHaveBeenCalled();
  });

  it.each([
    ["/admin", "Admin"],
    ["/account", "Account"],
    ["/commerce", "Commerce"],
    ["/sign-in", "Sign in"],
    ["/sign-in/factor-one", "Sign in"],
    ["/sign-up", "Sign up"],
    ["/sign-up/verify-email-address", "Sign up"],
    ["/missing", "Not found"],
  ])("opens %s directly", async (path, heading) => {
    openRoute(path);
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
  });

  it("preserves artifact-prefixed client navigation", async () => {
    openRoute("/school/", "/school");
    const link = screen.getByRole("link", { name: "Office" });
    expect(link.getAttribute("href")).toBe("/school/admin");
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { name: "Admin" })).toBeTruthy();
  });

  it("shows a loading status while a chunk is downloading", () => {
    const Pending = lazy(() => new Promise<never>(() => {}));
    render(<RouteBoundary><Pending /></RouteBoundary>);
    expect(screen.getByRole("status").textContent).toBe("Loading page…");
  });

  it("offers recovery when a chunk fails, including a base-aware home link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Failed = lazy(() => Promise.reject(new Error("Chunk download failed")));
    const location = memoryLocation({ path: "/school/admin" });
    render(
      <Router hook={location.hook} base="/school">
        <RouteBoundary><Failed /></RouteBoundary>
      </Router>,
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/school/");
  });
});
