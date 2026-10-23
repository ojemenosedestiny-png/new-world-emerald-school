import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HeroCarousel } from "../src/components/HeroCarousel";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(() => {
  cleanup();
  vi.useRealTimers();

  if (originalMatchMedia) {
    Object.defineProperty(window, "matchMedia", originalMatchMedia);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
});

describe("homepage photo slideshow", () => {
  it("starts with the bright Back to School photo and exposes labelled controls", () => {
    render(<HeroCarousel />);

    expect(screen.getByRole("region", { name: "School photographs" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /handmade Back to School frame/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next school photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause school photos" })).toBeTruthy();
  });

  it("pauses automatic changes after a visitor chooses a photo", () => {
    vi.useFakeTimers();
    render(<HeroCarousel />);

    fireEvent.click(screen.getByRole("button", { name: "Next school photo" }));
    expect(screen.getByTestId("hero-photo-caption").textContent).toContain("Photo 2 of 6");
    expect(screen.getByTestId("button-toggle-photo-rotation").getAttribute("aria-pressed")).toBe("true");

    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByTestId("hero-photo-caption").textContent).toContain("Photo 2 of 6");
  });

  it("rotates when playback is resumed", () => {
    vi.useFakeTimers();
    render(<HeroCarousel />);

    fireEvent.click(screen.getByRole("button", { name: "Pause school photos" }));
    fireEvent.click(screen.getByRole("button", { name: "Play school photos automatically" }));
    act(() => vi.advanceTimersByTime(7500));

    expect(screen.getByTestId("hero-photo-caption").textContent).toContain("Photo 2 of 6");
  });

  it("starts paused for visitors who prefer reduced motion", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    render(<HeroCarousel />);

    expect(screen.getByTestId("button-toggle-photo-rotation").getAttribute("aria-pressed")).toBe("true");
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByTestId("hero-photo-caption").textContent).toContain("Photo 1 of 6");
  });
});
