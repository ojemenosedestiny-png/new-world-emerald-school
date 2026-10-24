import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { LiveUpdatesManager } from "../src/components/LiveUpdatesManager";

const create = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListLiveUpdates: () => ({ data: [], isLoading: false, isError: false }),
  useCreateLiveUpdate: () => ({ mutateAsync: create, isPending: false }),
  useUpdateLiveUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteLiveUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestUploadUrl: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
afterEach(cleanup);

it("publishes a YouTube link as a live update", async () => {
  create.mockResolvedValue({});
  render(<QueryClientProvider client={new QueryClient()}><LiveUpdatesManager /></QueryClientProvider>);
  fireEvent.click(screen.getByTestId("button-add-live-update"));
  expect(screen.getByText("MP4, MOV, or another video up to 500 MB")).toBeTruthy();
  fireEvent.click(screen.getByTestId("button-source-youtube"));
  fireEvent.change(screen.getByTestId("input-live-update-youtube"), { target: { value: "https://vimeo.com/1" } });
  expect(screen.getByText("That does not look like a YouTube video link yet.")).toBeTruthy();
  fireEvent.change(screen.getByTestId("input-live-update-title"), { target: { value: "Cultural day" } });
  fireEvent.change(screen.getByTestId("input-live-update-description"), { target: { value: "A day of culture" } });
  fireEvent.click(screen.getByTestId("button-publish-live-update"));
  expect((await screen.findByTestId("error-live-update-form")).textContent).toContain("Paste a YouTube video link");
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("input-live-update-youtube"), { target: { value: "https://youtu.be/dQw4w9WgXcQ?si=x" } });
  fireEvent.click(screen.getByTestId("button-publish-live-update"));
  await waitFor(() => expect(create).toHaveBeenCalledWith({ data: {
    title: "Cultural day", description: "A day of culture", fileName: "https://youtu.be/dQw4w9WgXcQ?si=x",
    objectPath: "youtube:dQw4w9WgXcQ", contentType: "video/youtube", fileSize: 1,
  } }));
  expect((await screen.findByTestId("success-live-update")).textContent).toContain("YouTube video is now live");
});
