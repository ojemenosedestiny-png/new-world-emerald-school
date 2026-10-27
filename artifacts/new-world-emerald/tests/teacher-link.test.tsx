import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TeacherLink } from "../src/portal/manage/PeoplePanels";

afterEach(cleanup);

it("shows the teacher sign-in link and copies it", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<TeacherLink />);
  const url = `${window.location.origin}/teacher`;
  expect(screen.getByTestId("text-teacher-link").textContent).toBe(url);
  fireEvent.click(screen.getByTestId("button-copy-teacher-link"));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
  expect(await screen.findByText("Copied")).toBeTruthy();
});
