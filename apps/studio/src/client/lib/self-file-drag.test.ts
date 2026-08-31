import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isSelfFileDrag,
  releaseSelfFileDrag,
  trackSelfFileDrag,
} from "./self-file-drag";

describe("self file drag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    releaseSelfFileDrag();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds through the press that started the drag", () => {
    trackSelfFileDrag();

    vi.advanceTimersByTime(400);

    expect(isSelfFileDrag()).toBe(true);
  });

  // The case with no event behind it. A drag that goes straight out of the
  // window is never heard from again -- the OS owns it and Electron surfaces no
  // end -- so nothing but age can put the flag down, and every file dragged in
  // while it stands is discarded without a word.
  it("lets go of a drag nothing ever ended", () => {
    trackSelfFileDrag();

    vi.advanceTimersByTime(2000);

    expect(isSelfFileDrag()).toBe(false);
  });

  it("lets go the moment the drop region says the drag left", () => {
    trackSelfFileDrag();
    releaseSelfFileDrag();

    expect(isSelfFileDrag()).toBe(false);
  });
});
