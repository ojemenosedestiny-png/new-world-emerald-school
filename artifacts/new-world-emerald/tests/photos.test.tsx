import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalSession } from "@workspace/api-client-react";
import { Avatar, imageUrl, initialsOf, preparePhoto } from "../src/portal/photos";
import { StudentGallery } from "../src/portal/StudentGallery";
import { StudentProfile } from "../src/portal/StudentProfile";
import { PhotoReviewsPanel } from "../src/portal/manage/GalleryPanel";

const state = vi.hoisted(() => ({ photo: { photoId: null as string | null, pendingPhotoId: null as string | null, uploadsEnabled: true }, decide: vi.fn(), upload: vi.fn() }));
const albums = [
  { id: 1, title: "Sports day", description: "Relay and long jump", classId: null, className: null, published: true, createdAt: "2026-10-20T10:00:00Z",
    photos: [{ id: 11, imageId: "aaaa", caption: "Relay race" }, { id: 12, imageId: "bbbb", caption: "" }, { id: 13, imageId: "cccc", caption: "Prize giving" }] },
  { id: 2, title: "Empty album", description: "", classId: null, className: null, published: true, createdAt: "2026-10-21T10:00:00Z", photos: [] },
];
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListPortalAlbums: () => ({ data: albums, isLoading: false, isError: false }),
  useGetMyPhoto: () => ({ data: state.photo }),
  useUploadMyPhoto: () => ({ mutateAsync: state.upload, isPending: false }),
  useListPhotoReviews: () => ({ isLoading: false, isError: false, data: [{ id: 5, name: "Ada Obi", studentId: "NWE/2026/00001", className: "JSS 1", photoId: null, pendingPhotoId: "pppp" }] }),
  useDecidePhotoReview: () => ({ mutateAsync: state.decide, isPending: false }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); state.photo = { photoId: null, pendingPhotoId: null, uploadsEnabled: true }; });

describe("photo helpers", () => {
  it("builds private image links and initials", () => {
    expect(imageUrl("ab/c")).toMatch(/\/api\/portal\/images\/ab%2Fc$/);
    expect(initialsOf("Dr Tunde Adeyemi")).toBe("TA");
    expect(initialsOf("")).toBe("?");
  });
  it("rejects files that are not photos and keeps small originals when the browser cannot resize", async () => {
    await expect(preparePhoto(new File(["x"], "a.gif", { type: "image/gif" }), 800)).rejects.toThrow(/JPEG, PNG or WebP/);
    const small = new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" });
    expect(await preparePhoto(small, 800)).toBe(small); // jsdom has no image decoding
  });
  it("shows initials until a photo exists", () => {
    const { rerender } = render(<Avatar name="Ada Obi" />);
    expect(screen.getByText("AO")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    rerender(<Avatar name="Ada Obi" photoId="abc" />);
    expect(document.querySelector("img")?.getAttribute("src")).toMatch(/images\/abc$/);
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("student gallery", () => {
  it("hides empty albums, opens an album and steps through photos", async () => {
    render(wrap(<StudentGallery />));
    expect(screen.getByTestId("album-1").textContent).toContain("3");
    expect(screen.queryByTestId("album-2")).toBeNull();
    fireEvent.click(screen.getByTestId("album-1"));
    expect(screen.getByTestId("text-album-title").textContent).toBe("Sports day");
    fireEvent.click(screen.getByTestId("photo-13"));
    expect((await screen.findByTestId("photo-viewer")).textContent).toContain("Prize giving");
    fireEvent.click(screen.getByTestId("button-photo-next"));
    expect(screen.getByTestId("photo-viewer").textContent).toContain("Relay race");
    fireEvent.click(screen.getByTestId("button-photo-prev"));
    expect(screen.getByTestId("photo-viewer").textContent).toContain("3 / 3");
    fireEvent.click(screen.getByTestId("button-photo-close"));
    await waitFor(() => expect(screen.queryByTestId("photo-viewer")).toBeNull());
    fireEvent.click(screen.getByTestId("button-back-albums"));
    expect(screen.getByTestId("list-albums")).toBeTruthy();
  });
});

describe("profile photo", () => {
  const session = { role: "student", name: "Ada Obi", studentId: "NWE/2026/00001", classIds: [1], mustChangePassword: false } as PortalSession;
  it("explains when uploads are off", () => {
    state.photo = { photoId: null, pendingPhotoId: null, uploadsEnabled: false };
    render(wrap(<StudentProfile session={session} className="JSS 1" />));
    expect((screen.getByTestId("button-upload-photo") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("panel-photo").textContent).toContain("not switched on yet");
  });
  it("shows a waiting photo and uploads a new one", async () => {
    state.photo = { photoId: null, pendingPhotoId: "pppp", uploadsEnabled: true };
    state.upload.mockResolvedValue({ photoId: null, pendingPhotoId: "qqqq", uploadsEnabled: true });
    render(wrap(<StudentProfile session={session} className="JSS 1" />));
    expect(screen.getByTestId("text-photo-pending")).toBeTruthy();
    expect(screen.getByTestId("button-upload-photo").textContent).toContain("Change photo");
    const file = new File([new Uint8Array(20)], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("input-photo"), { target: { files: [file] } });
    await waitFor(() => expect(state.upload).toHaveBeenCalledWith({ data: file }));
  });
});

describe("photo approvals", () => {
  it("approves and declines", async () => {
    state.decide.mockResolvedValue({ message: "ok" });
    render(wrap(<PhotoReviewsPanel />));
    expect(screen.getByTestId("review-5").textContent).toContain("Ada Obi");
    fireEvent.click(screen.getByTestId("button-approve-5"));
    await waitFor(() => expect(state.decide).toHaveBeenCalledWith({ id: 5, data: { approve: true } }));
    fireEvent.click(screen.getByTestId("button-decline-5"));
    await waitFor(() => expect(state.decide).toHaveBeenLastCalledWith({ id: 5, data: { approve: false } }));
  });
});
