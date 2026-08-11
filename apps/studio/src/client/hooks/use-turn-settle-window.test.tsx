import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTurnSettleWindow } from "./use-turn-settle-window";

// Longer than the hook's own window, so advancing by it always closes one.
const PAST_THE_WINDOW_MS = 5000;

describe("useTurnSettleWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays shut while the session is alive", () => {
    const { result } = renderHook(
      (alive: boolean) => useTurnSettleWindow(alive),
      {
        initialProps: true,
      },
    );

    expect(result.current).toBe(false);
  });

  it("stays shut for a transcript that was already idle when it mounted", () => {
    const { result } = renderHook(
      (alive: boolean) => useTurnSettleWindow(alive),
      {
        initialProps: false,
      },
    );

    expect(result.current).toBe(false);
  });

  it("opens when the turn ends and closes on its own", () => {
    const { rerender, result } = renderHook(
      (alive: boolean) => useTurnSettleWindow(alive),
      { initialProps: true },
    );

    rerender(false);
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(PAST_THE_WINDOW_MS);
    });
    expect(result.current).toBe(false);
  });

  it("closes as soon as the next turn starts", () => {
    const { rerender, result } = renderHook(
      (alive: boolean) => useTurnSettleWindow(alive),
      { initialProps: true },
    );

    rerender(false);
    expect(result.current).toBe(true);

    rerender(true);
    expect(result.current).toBe(false);
  });
});
