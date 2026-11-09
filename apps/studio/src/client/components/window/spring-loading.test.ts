import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { maySpring, SPRING_DELAY_MS, springTimer } from "./spring-loading";

type Timer = ReturnType<typeof springTimer>;

describe("springTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a folder once the drag has rested on it, and once only", () => {
    const spring = vi.fn();
    const timer = springTimer(spring);

    timer.rest("a/");
    vi.advanceTimersByTime(SPRING_DELAY_MS - 1);
    expect(spring).not.toHaveBeenCalled();
    // The drag is heard from again over the same folder, which puts nothing off.
    timer.rest("a/");
    vi.advanceTimersByTime(1);
    expect(spring).toHaveBeenCalledExactlyOnceWith("a/");

    timer.rest("a/");
    vi.advanceTimersByTime(SPRING_DELAY_MS * 2);
    expect(spring).toHaveBeenCalledOnce();
  });

  it("starts over on another folder, which is how a drag goes two folders down", () => {
    const spring = vi.fn();
    const timer = springTimer(spring);

    timer.rest("a/");
    vi.advanceTimersByTime(SPRING_DELAY_MS - 1);
    timer.rest("b/");
    vi.advanceTimersByTime(SPRING_DELAY_MS - 1);
    expect(spring).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(spring).toHaveBeenLastCalledWith("b/");

    timer.rest("b/c/");
    vi.advanceTimersByTime(SPRING_DELAY_MS);
    expect(spring).toHaveBeenLastCalledWith("b/c/");
  });

  it.each([
    ["moves off onto no folder", (timer: Timer) => timer.rest(null)],
    ["ends", (timer: Timer) => timer.stop()],
  ])("opens nothing when the drag %s first", (_name, away) => {
    const spring = vi.fn();
    const timer = springTimer(spring);

    timer.rest("a/");
    vi.advanceTimersByTime(SPRING_DELAY_MS - 1);
    away(timer);
    vi.advanceTimersByTime(SPRING_DELAY_MS);

    expect(spring).not.toHaveBeenCalled();
  });
});

describe("maySpring", () => {
  const resting = {
    asksFirst: false,
    carried: [] as string[],
    folder: "Documents/Old/",
    hostPath: "/Users/mac-user/Documents/Old",
    onScreen: "Documents/",
    refused: false,
  };

  it.each<[string, Partial<typeof resting>, boolean]>([
    ["a folder listed in the one on screen", {}, true],
    ["the folder on screen", { onScreen: "Documents/Old/" }, false],
    [
      "a folder above the one on screen, in the columns",
      { onScreen: "Documents/Old/2024/" },
      false,
    ],
    ["a folder the system would ask about", { asksFirst: true }, false],
    ["a folder the system refused", { refused: true }, false],
    [
      "the folder being dragged",
      { carried: ["/Users/mac-user/Documents/Old"] },
      false,
    ],
    [
      "a folder inside the one being dragged",
      { carried: ["/Users/mac-user/Documents"] },
      false,
    ],
    [
      "a folder beside what is being dragged",
      { carried: ["/Users/mac-user/Documents/Older"] },
      true,
    ],
  ])("%s", (_name, change, expected) => {
    expect(maySpring({ ...resting, ...change })).toBe(expected);
  });
});
