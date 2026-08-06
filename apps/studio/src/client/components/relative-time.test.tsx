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

describe("RelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
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
});
