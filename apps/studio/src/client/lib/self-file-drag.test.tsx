import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  endOwnFileDrag,
  isOwnFileDragOf,
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

  describe("what it carries", () => {
    beforeEach(() => {
      endOwnFileDrag();
    });

    // A drag held over a folder for a while is still the Finder's own, which
    // moves rather than copies.
    it("knows its own files while the drag is held", () => {
      trackSelfFileDrag(["/a.txt", "/pics"]);
      vi.advanceTimersByTime(10_000);

      expect(isOwnFileDragOf(["/pics", "/a.txt"])).toBe(true);
      expect(isOwnFileDragOf(["/a.txt"])).toBe(false);
      expect(isOwnFileDragOf(["/a.txt", "/pics", "/b.txt"])).toBe(false);
    });

    // The OS owns the drag until it ends, so a pointer event after the first
    // moments means it went somewhere else, and the same files dragged in
    // from the desktop next are not taken for it.
    it("forgets them at the first pointer event after the drag", () => {
      trackSelfFileDrag(["/a.txt"]);
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new PointerEvent("pointermove"));
      expect(isOwnFileDragOf(["/a.txt"])).toBe(true);

      vi.advanceTimersByTime(500);
      window.dispatchEvent(new PointerEvent("pointermove"));
      expect(isOwnFileDragOf(["/a.txt"])).toBe(false);
    });

    it("leaves them to a drop region's release of the flag", () => {
      trackSelfFileDrag(["/a.txt"]);
      releaseSelfFileDrag();

      expect(isOwnFileDragOf(["/a.txt"])).toBe(true);
    });

    // Dragged out to another app without the window hearing it end, then
    // the same files dragged back in from elsewhere: not this drag.
    it.each(["blur", "focus"])(
      "forgets them when the window's focus changes (%s)",
      (event) => {
        trackSelfFileDrag(["/a.txt"]);
        window.dispatchEvent(new Event(event));

        expect(isOwnFileDragOf(["/a.txt"])).toBe(false);
      },
    );

    it("forgets them once older than any drag is held", () => {
      trackSelfFileDrag(["/a.txt"]);
      vi.advanceTimersByTime(31_000);

      expect(isOwnFileDragOf(["/a.txt"])).toBe(false);
    });
  });
});
