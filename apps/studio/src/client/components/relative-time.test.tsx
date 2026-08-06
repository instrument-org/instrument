import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelativeTime } from "./relative-time";

const NOW = new Date("2026-08-06T15:30:00").getTime();

const DAY_MS = 24 * 60 * 60 * 1000;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Drives visibility the way the window does, and separately from the event, so
 * a test can model Electron delivering one without the other.
 */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: hidden ? "hidden" : "visible",
  });
}

describe("RelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    // Visibility is module state shared by every test in this file, so leave it
    // resumed however the test under way left it.
    setHidden(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    vi.useRealTimers();
  });

  it("moves to the next unit while it sits on screen", async () => {
    renderWithProviders(
      <RelativeTime date={new Date(NOW - 5000)} tooltip={false} />,
    );

    expect(screen.getByText("< 1 minute ago")).toBeTruthy();

    await advance(60_000);
    expect(screen.getByText("1 minute ago")).toBeTruthy();

    await advance(4 * 60_000);
    expect(screen.getByText("5 minutes ago")).toBeTruthy();
  });

  it("runs one timer for many instances of the same cadence", () => {
    renderWithProviders(
      <>
        <RelativeTime date={new Date(NOW - 5000)} tooltip={false} />
        <RelativeTime date={new Date(NOW - 6000)} tooltip={false} />
        <RelativeTime date={new Date(NOW - 7000)} tooltip={false} />
      </>,
    );

    expect(vi.getTimerCount()).toBe(1);
  });

  it("schedules nothing for a date old enough to render as a date", () => {
    renderWithProviders(
      <RelativeTime date={new Date(NOW - 30 * DAY_MS)} tooltip={false} />,
    );

    expect(screen.getByText("Jul 7")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tears its timer down when the last instance unmounts", () => {
    const { unmount } = renderWithProviders(
      <RelativeTime date={new Date(NOW - 5000)} tooltip={false} />,
    );

    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("when the window goes away", () => {
    function hide() {
      setHidden(true);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }

    it("stops ticking, keeping only the poll that can wake it", async () => {
      renderWithProviders(
        <RelativeTime date={new Date(NOW - 5000)} tooltip={false} />,
      );
      expect(vi.getTimerCount()).toBe(1);

      hide();

      // The cadence timer is gone; what remains is the resume poll.
      expect(vi.getTimerCount()).toBe(1);
      await advance(10 * 60_000);
      expect(screen.getByText("< 1 minute ago")).toBeTruthy();
    });

    it("catches up in one step when the window comes back", async () => {
      renderWithProviders(
        <RelativeTime date={new Date(NOW - 5000)} tooltip={false} />,
      );

      hide();
      await advance(10 * 60_000);

      setHidden(false);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(screen.getByText("10 minutes ago")).toBeTruthy();
    });

    it("resumes on focus alone, which is all Electron may deliver", async () => {
      renderWithProviders(
        <RelativeTime date={new Date(NOW - 5000)} tooltip={false} />,
      );

      hide();
      await advance(10 * 60_000);

      // Shown again with no visibilitychange to go with it.
      setHidden(false);
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(screen.getByText("10 minutes ago")).toBeTruthy();
    });

    it("resumes on its own when neither signal ever arrives", async () => {
      renderWithProviders(
        <RelativeTime date={new Date(NOW - 5000)} tooltip={false} />,
      );

      hide();
      setHidden(false);

      // No event of either kind. The poll is the only thing left to notice.
      await advance(10 * 60_000);
      expect(screen.getByText("10 minutes ago")).toBeTruthy();
    });
  });
});
