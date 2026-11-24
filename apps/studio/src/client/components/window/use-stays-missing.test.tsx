import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useStaysMissing } from "./use-stays-missing";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const there = { isMissing: false, isThere: true };
const missing = { isMissing: true, isThere: false };

it("says a chat whose record went is gone at once", () => {
  const { rerender, result } = renderHook(useStaysMissing, {
    initialProps: there,
  });
  rerender(missing);
  expect(result.current).toBe(true);
  rerender(there);
  expect(result.current).toBe(false);
});

it("gives a chat still being made its grace", () => {
  const { result } = renderHook(useStaysMissing, { initialProps: missing });
  expect(result.current).toBe(false);
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  expect(result.current).toBe(true);
});
