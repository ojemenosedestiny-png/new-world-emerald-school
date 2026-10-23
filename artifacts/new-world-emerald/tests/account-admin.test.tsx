import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  ApiError,
  getGetLocalAccountQueryKey,
  getGetWebsiteAdminAccessQueryKey,
  getListAdmissionApplicationsQueryKey,
} from "@workspace/api-client-react";
import Account from "../src/pages/Account";
import Admin from "../src/pages/Admin";

// In-memory fixtures only: no Clerk provider, real sessions, or privileged users.
const clerk = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: false },
  user: null as null | {
    id: string;
    externalId?: string | null;
    primaryEmailAddress: { emailAddress: string };
  },
  signOut: vi.fn(),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => clerk.auth,
  useUser: () => ({ user: clerk.user }),
  useClerk: () => ({ signOut: clerk.signOut }),
}));

// Exercise the page's access boundary, not the managers' independent queries/UI.
vi.mock("@/components/LiveUpdatesManager", () => ({
  LiveUpdatesManager: () => <div data-testid="updates-manager" />,
}));
vi.mock("@/components/SiteContentManager", () => ({
  SiteContentManager: () => <div data-testid="content-manager" />,
}));
vi.mock("@/components/SchoolCommerceManager", () => ({
  SchoolCommerceManager: () => <div data-testid="commerce-manager" />,
}));
vi.mock("@/components/GraphicsStudio", () => ({
  GraphicsStudio: () => <div data-testid="graphics-manager" />,
}));
vi.mock("@/components/AcademicCalendar", () => ({
  AcademicCalendar: () => <div data-testid="calendar-manager" />,
}));

const accountUrl = "/api/account";
const accessUrl = "/api/website-admin/access";
const applicationsUrl = "/api/admission-applications";
const calendarUrl = "/api/academic-calendar";
const approvalMessage = "Only accounts approved by the school can manage this website. Sign in with an approved administrator account.";
type Responder = () => Response | Promise<Response>;
let responses: Map<string, Responder>;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signIn(id = "fixture-user-a", externalId?: string | null) {
  clerk.auth = { isLoaded: true, isSignedIn: true };
  clerk.user = { id, externalId, primaryEmailAddress: { emailAddress: "fixture@example.test" } };
}

function requestsTo(url: string) {
  return fetchMock.mock.calls.filter(([input]) => input === url);
}

function openPage(page: ReactElement) {
  const location = memoryLocation({ path: "/", record: true });
  const wrap = (element: ReactElement) => (
    <QueryClientProvider client={client}>
      <Router hook={location.hook}>{element}</Router>
    </QueryClientProvider>
  );
  const view = render(wrap(page));
  // A fresh element forces the mocked auth consumers to render again, as a
  // Clerk context update would, without remounting the page or its QueryClient.
  return { ...view, location, rerenderPage: () => view.rerender(wrap(cloneElement(page))) };
}

function expectNoManagement() {
  for (const name of ["updates", "content", "commerce", "graphics"]) {
    expect(screen.queryByTestId(`${name}-manager`)).toBeNull();
  }
  expect(screen.queryByText("Admission applications")).toBeNull();
}

beforeEach(() => {
  clerk.auth = { isLoaded: true, isSignedIn: false };
  clerk.user = null;
  clerk.signOut.mockReset();
  // Keep retries on by default so the pages' explicit retry:false is tested.
  client = new QueryClient({
    defaultOptions: { queries: { retry: 3, gcTime: Infinity } },
  });
  responses = new Map([
    [accountUrl, () => json({ id: "fixture-school-account", isAdmin: false })],
    [accessUrl, () => json({ isAdmin: false })],
    [applicationsUrl, () => json([])],
    [calendarUrl, () => json([])],
  ]);
  fetchMock = vi.fn((input: string) => {
    const respond = responses.get(input);
    if (!respond) throw new Error(`Unexpected test request: ${input}`);
    return respond();
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

describe("School account screen", () => {
  it("shows sign-in while signed out without requesting the account", async () => {
    openPage(<Account />);
    expect(screen.getByRole("link", { name: "Sign in with email" }).getAttribute("href")).toBe("/sign-in");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    await act(async () => {});
    expect(requestsTo(accountUrl)).toHaveLength(0);
    expect(client.getQueryCache().find({ queryKey: [...getGetLocalAccountQueryKey(), undefined], exact: true })?.state.fetchStatus).toBe("idle");
  });

  it("waits for Clerk to load before requesting the account", async () => {
    clerk.auth = { isLoaded: false, isSignedIn: false };
    const view = openPage(<Account />);
    expect(screen.getByText("Checking your account…")).toBeTruthy();
    await act(async () => {});
    expect(requestsTo(accountUrl)).toHaveLength(0);
    signIn();
    view.rerenderPage();
    expect(await screen.findByTestId("school-account-loaded")).toBeTruthy();
    expect(requestsTo(accountUrl)).toHaveLength(1);
  });

  it("shows account loading until the API responds", async () => {
    signIn();
    let resolve!: (response: Response) => void;
    responses.set(accountUrl, () => new Promise<Response>((done) => { resolve = done; }));
    openPage(<Account />);
    expect(screen.getByText("Loading your school account…")).toBeTruthy();
    expect(screen.queryByTestId("school-account-loaded")).toBeNull();
    await act(async () => { resolve(json({ isAdmin: false })); });
    expect(await screen.findByText("Administrator access requires school approval.")).toBeTruthy();
  });

  it.each([false, true])("renders the server's approval result (isAdmin=%s)", async (isAdmin) => {
    signIn();
    responses.set(accountUrl, () => json({ isAdmin }));
    openPage(<Account />);
    expect(await screen.findByTestId("school-account-loaded")).toBeTruthy();
    expect(screen.getByText("fixture@example.test")).toBeTruthy();
    expect(screen.getByText(isAdmin ? "Approved school administrator" : "Administrator access requires school approval.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open admin panel" }).getAttribute("href")).toBe("/admin");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: import.meta.env.BASE_URL });
  });

  it.each([401, 403, 500])("preserves the account error message and manual recovery (%s)", async (status) => {
    signIn();
    responses.set(accountUrl, () => json({ error: "Fixture failure" }, status));
    openPage(<Account />);
    expect((await screen.findByRole("alert")).textContent).toContain("Your school account could not be loaded.");
    expect(screen.queryByTestId("school-account-loaded")).toBeNull();
    const query = client.getQueryCache().find({ queryKey: [...getGetLocalAccountQueryKey(), "fixture-user-a"], exact: true });
    expect(query?.options.retry).toBe(false);
    expect(query?.state.error).toBeInstanceOf(ApiError);
    expect(requestsTo(accountUrl)).toHaveLength(1);
    responses.set(accountUrl, () => json({ isAdmin: false }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("school-account-loaded")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(requestsTo(accountUrl)).toHaveLength(2);
  });
});

describe("Administrator access screen", () => {
  it("offers sign-in without requesting access or private admissions while signed out", async () => {
    const view = openPage(<Admin />);
    expect(screen.getByText("Sign in to review admission applications and manage weekly school updates.")).toBeTruthy();
    await act(async () => {});
    expect(requestsTo(accessUrl)).toHaveLength(0);
    expect(requestsTo(applicationsUrl)).toHaveLength(0);
    expect(client.getQueryCache().find({ queryKey: [...getGetWebsiteAdminAccessQueryKey(), "anonymous"], exact: true })?.state.fetchStatus).toBe("idle");
    expectNoManagement();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with email" }));
    expect(view.location.history?.at(-1)).toBe("/sign-in");
  });

  it("waits for Clerk before checking access", async () => {
    clerk.auth = { isLoaded: false, isSignedIn: false };
    const view = openPage(<Admin />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(view.container.querySelector(".animate-spin")).not.toBeNull();
    await act(async () => {});
    expect(requestsTo(accessUrl)).toHaveLength(0);
    expect(requestsTo(applicationsUrl)).toHaveLength(0);
    signIn();
    view.rerenderPage();
    expect(await screen.findByText("Administrator access required")).toBeTruthy();
    expect(requestsTo(accessUrl)).toHaveLength(1);
  });

  it("keeps management and admissions disabled while access is pending", async () => {
    signIn();
    let resolve!: (response: Response) => void;
    responses.set(accessUrl, () => new Promise<Response>((done) => { resolve = done; }));
    const view = openPage(<Admin />);
    expect(view.container.querySelector(".animate-spin")).not.toBeNull();
    expectNoManagement();
    expect(requestsTo(applicationsUrl)).toHaveLength(0);
    await act(async () => { resolve(json({ isAdmin: false })); });
    expect(await screen.findByText(approvalMessage)).toBeTruthy();
  });

  it("explains school approval to signed-in non-administrators", async () => {
    signIn();
    openPage(<Admin />);
    expect(await screen.findByRole("heading", { name: "Administrator access required" })).toBeTruthy();
    expect(screen.getByText(approvalMessage)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View school account" }).getAttribute("href")).toBe("/account");
    expect(screen.queryByRole("button", { name: "Retry access check" })).toBeNull();
    expectNoManagement();
    expect(requestsTo(applicationsUrl)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Sign out / use another account" }));
    expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: import.meta.env.BASE_URL });
  });

  it("renders management and requests admissions only after approval", async () => {
    signIn();
    responses.set(accessUrl, () => json({ isAdmin: true }));
    openPage(<Admin />);
    expect(await screen.findByRole("heading", { name: "Good morning, school office." })).toBeTruthy();
    for (const name of ["updates", "content", "commerce", "graphics"]) {
      expect(screen.getByTestId(`${name}-manager`)).toBeTruthy();
    }
    expect(await screen.findByText("No applications yet")).toBeTruthy();
    expect(requestsTo(applicationsUrl)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: import.meta.env.BASE_URL });
  });

  it.each([401, 403])("treats an actual ApiError %s as denied, not a retryable outage", async (status) => {
    signIn();
    responses.set(accessUrl, () => json({ error: "Fixture denied" }, status));
    openPage(<Admin />);
    expect(await screen.findByRole("heading", { name: "Administrator access required" })).toBeTruthy();
    expect(screen.getByText(approvalMessage)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry access check" })).toBeNull();
    const error = client.getQueryState([...getGetWebsiteAdminAccessQueryKey(), "fixture-user-a"])?.error;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toHaveProperty("status", status);
    expectNoManagement();
    expect(requestsTo(applicationsUrl)).toHaveLength(0);
  });

  it.each(["server", "network", "lookalike"] as const)("allows manual recovery from a %s error without exposing management", async (failure) => {
    signIn();
    responses.set(accessUrl, () => {
      if (failure === "server") return json({ error: "Fixture unavailable" }, 503);
      // A status property alone must not be mistaken for the exported ApiError.
      throw failure === "lookalike"
        ? Object.assign(new Error("Fixture failure"), { status: 403 })
        : new TypeError("Fixture offline");
    });
    openPage(<Admin />);
    expect(await screen.findByRole("heading", { name: "Access check unavailable" })).toBeTruthy();
    expect(screen.getByText("We could not confirm your access. Please retry.")).toBeTruthy();
    expectNoManagement();
    expect(requestsTo(applicationsUrl)).toHaveLength(0);
    const query = client.getQueryCache().find({ queryKey: [...getGetWebsiteAdminAccessQueryKey(), "fixture-user-a"], exact: true });
    expect(query?.options.retry).toBe(false);
    expect(requestsTo(accessUrl)).toHaveLength(1);
    responses.set(accessUrl, () => json({ isAdmin: true }));
    fireEvent.click(screen.getByRole("button", { name: "Retry access check" }));
    expect(await screen.findByRole("heading", { name: "Good morning, school office." })).toBeTruthy();
    expect(requestsTo(accessUrl)).toHaveLength(2);
    await waitFor(() => expect(requestsTo(applicationsUrl)).toHaveLength(1));
  });
});

describe.each([
  { name: "account", Page: Account, url: accountUrl, baseKey: getGetLocalAccountQueryKey() },
  { name: "admin", Page: Admin, url: accessUrl, baseKey: getGetWebsiteAdminAccessQueryKey() },
])("$name identity-scoped queries", ({ Page, url, baseKey }) => {
  it.each([undefined, null, "fixture-local-id"])("uses externalId when present, otherwise the Clerk id (%s)", async (externalId) => {
    signIn("fixture-clerk-id", externalId);
    openPage(<Page />);
    const key = [...baseKey, externalId ?? "fixture-clerk-id"];
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe("success"));
    expect(client.getQueryCache().find({ queryKey: baseKey, exact: true })).toBeUndefined();
    expect(requestsTo(url)).toHaveLength(1);
  });

  it("checks a new identity rather than reusing another user's cached approval", async () => {
    signIn("fixture-clerk-a", "fixture-local-a");
    responses.set(url, () => json({ isAdmin: true }));
    const view = openPage(<Page />);
    await screen.findByText(Page === Account ? "Approved school administrator" : "Good morning, school office.");
    // Keep the same mounted page and QueryClient, as during an account switch.
    let resolve!: (response: Response) => void;
    responses.set(url, () => new Promise<Response>((done) => { resolve = done; }));
    signIn("fixture-clerk-b", "fixture-local-b");
    view.rerenderPage();
    expect(screen.queryByText("Approved school administrator")).toBeNull();
    expect(screen.queryByText("Good morning, school office.")).toBeNull();
    expectNoManagement();
    expect(client.getQueryState([...baseKey, "fixture-local-a"])?.data).toEqual({ isAdmin: true });
    expect(client.getQueryState([...baseKey, "fixture-local-b"])?.data).toBeUndefined();
    expect(requestsTo(url)).toHaveLength(2);
    await act(async () => { resolve(json({ isAdmin: false })); });
    expect(await screen.findByText(Page === Account ? "Administrator access requires school approval." : approvalMessage)).toBeTruthy();
    expect(client.getQueryState([...baseKey, "fixture-local-b"])?.data).toEqual({ isAdmin: false });
    const requestsBeforeSignOut = requestsTo(url).length;
    clerk.auth = { isLoaded: true, isSignedIn: false };
    clerk.user = null;
    view.rerenderPage();
    expect(screen.getByText("Sign in with email")).toBeTruthy();
    await act(async () => {});
    expect(requestsTo(url)).toHaveLength(requestsBeforeSignOut);
    expectNoManagement();
    // Public calendar reads are intentionally allowed; private admissions are not.
    const admissions = client.getQueryCache().find({ queryKey: getListAdmissionApplicationsQueryKey(), exact: true });
    if (Page === Admin) expect(admissions?.isActive()).toBe(false);
  });
});
