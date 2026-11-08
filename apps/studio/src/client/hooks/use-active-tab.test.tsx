import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { refreshWhileShown } from "./use-active-tab";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// A DOM test though nothing renders: TanStack runs no clock where there is no
// `window`.

// Window tabs stay mounted behind the one up, and TanStack pauses a clock only
// when the whole document is hidden, so the tab's own answer has to stop it.
it("re-reads on the clock only while its tab is up, and at once on coming back", async () => {
  const client = new QueryClient();
  const read = vi.fn(() => Promise.resolve("listing"));
  const optionsFor = (isShown: boolean) => ({
    queryFn: read,
    queryKey: ["folder"],
    ...refreshWhileShown(isShown, 4000),
  });
  const observer = new QueryObserver(client, optionsFor(true));
  const unsubscribe = observer.subscribe(() => undefined);
  await vi.advanceTimersByTimeAsync(8000);
  expect(read).toHaveBeenCalledTimes(3);

  observer.setOptions(optionsFor(false));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(read).toHaveBeenCalledTimes(3);

  observer.setOptions(optionsFor(true));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(4000);
  expect(read).toHaveBeenCalledTimes(5);
  unsubscribe();
});

it("still makes its first read in a tab mounted behind another", async () => {
  const client = new QueryClient();
  const read = vi.fn(() => Promise.resolve("listing"));
  const observer = new QueryObserver(client, {
    queryFn: read,
    queryKey: ["folder"],
    ...refreshWhileShown(false, 4000),
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(read).toHaveBeenCalledTimes(1);
  unsubscribe();
});
