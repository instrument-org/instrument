import { useUpdatedNote } from "@/client/components/updated-note";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let focused = true;

beforeEach(() => {
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

let tabUp = true;

function renderNote(isActive: boolean) {
  tabUp = isActive;
  return renderHook(() => useUpdatedNote(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ActiveTabProvider isActive={tabUp}>{children}</ActiveTabProvider>
    ),
  });
}

it("says an update at once in the tab up of a focused window", () => {
  const { result } = renderNote(true);
  act(() => {
    result.current.mark();
  });
  expect(result.current).toMatchObject({ ago: null, shown: true, turn: 1 });
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(result.current.shown).toBe(false);
});

it("holds an update made behind another tab until the tab is up", () => {
  const { rerender, result } = renderNote(false);
  act(() => {
    result.current.mark();
  });
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(result.current.shown).toBe(false);
  tabUp = true;
  rerender();
  expect(result.current).toMatchObject({ ago: null, shown: true });
});

it("holds an update made while the window is unfocused, and says how long ago", () => {
  focused = false;
  const { result } = renderNote(true);
  act(() => {
    result.current.mark();
  });
  act(() => {
    vi.advanceTimersByTime(3 * 60_000);
  });
  expect(result.current.shown).toBe(false);
  act(() => {
    focused = true;
    window.dispatchEvent(new Event("focus"));
  });
  expect(result.current).toMatchObject({
    ago: "3 minutes ago",
    shown: true,
    turn: 1,
  });
});

it("says nothing of a written time from long ago on a write seen as it lands", () => {
  const { result } = renderNote(true);
  act(() => {
    result.current.mark(Date.now() - 400 * 24 * 60 * 60_000);
  });
  expect(result.current).toMatchObject({ ago: null, shown: true });
});

it("dates a write taken in on coming back to a tab by the file, within the time away", () => {
  const { rerender, result } = renderNote(true);
  tabUp = false;
  rerender();
  act(() => {
    vi.advanceTimersByTime(5 * 60_000);
  });
  tabUp = true;
  rerender();
  act(() => {
    result.current.mark(Date.now() - 2 * 60_000);
  });
  expect(result.current.ago).toBe("2 minutes ago");
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  tabUp = false;
  rerender();
  act(() => {
    vi.advanceTimersByTime(4 * 60_000);
  });
  tabUp = true;
  rerender();
  act(() => {
    result.current.mark(Date.now() - 400 * 24 * 60 * 60_000);
  });
  expect(result.current.ago).toBe("4 minutes ago");
});
