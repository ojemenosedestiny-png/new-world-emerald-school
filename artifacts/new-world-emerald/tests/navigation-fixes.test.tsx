import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, expect, it, vi } from "vitest";
import { Navbar } from "../src/components/Layout";
import { AdmissionsFAQ } from "../src/components/AdmissionsNews";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const wrap = (path: string, el: React.ReactElement) => {
  const { hook } = memoryLocation({ path });
  return <QueryClientProvider client={new QueryClient()}><Router hook={hook}>{el}</Router></QueryClientProvider>;
};

it("the logo takes you back to the top of the homepage when you are already on it", () => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.history.replaceState(null, "", "/#admissions");
  render(wrap("/", <Navbar />));
  fireEvent.click(screen.getByTestId("link-home-logo"));
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  expect(window.location.hash).toBe("", "the #section is cleared");
});

it("the prospectus button asks by email until the office uploads one", () => {
  render(wrap("/", <AdmissionsFAQ />));
  const request = screen.getByTestId("link-request-prospectus");
  expect(request.getAttribute("href")).toMatch(/^mailto:info@newworldemeraldprivateschool\.com\?subject=Prospectus/);
  expect(screen.queryByTestId("link-download-prospectus")).toBeNull();
});
