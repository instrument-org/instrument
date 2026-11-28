import {
  endOwnFileDrag,
  releaseSelfFileDrag,
  sawOwnFileDrag,
  trackSelfFileDrag,
} from "@/client/lib/self-file-drag";
import { installWindowStubs } from "@/tests/window-stubs";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWindowDropFallback } from "./use-window-drop-fallback";

/** Files let go of over the window where nothing took them, as the system's drag hands them over. */
function drop(names: readonly string[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      items: names.map((name) => ({
        getAsFile: () => new File([], name),
        kind: "file",
        webkitGetAsEntry: () => null,
      })),
      types: ["Files"],
    },
  });
  window.dispatchEvent(event);
}

describe("the window as the drop of last resort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installWindowStubs();
    releaseSelfFileDrag();
    endOwnFileDrag();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens files dragged in from elsewhere", () => {
    const onOpen = vi.fn();
    renderHook(() => {
      useWindowDropFallback(onOpen);
    });

    drop(["a.txt", "b.txt"]);

    expect(onOpen).toHaveBeenCalledWith([
      { hostPath: "a.txt", isFolder: false },
      { hostPath: "b.txt", isFolder: false },
    ]);
  });

  it("opens nothing for rows of Files let go of where nothing takes them, however long they were held", () => {
    const onOpen = vi.fn();
    renderHook(() => {
      useWindowDropFallback(onOpen);
    });
    trackSelfFileDrag(["a.txt"]);
    // Held over the window, which hears of the drag as long as it is.
    for (let held = 0; held < 8; held += 1) {
      vi.advanceTimersByTime(1000);
      sawOwnFileDrag();
    }

    drop(["a.txt"]);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the same file dragged in from elsewhere once that drag is over", () => {
    const onOpen = vi.fn();
    renderHook(() => {
      useWindowDropFallback(onOpen);
    });
    trackSelfFileDrag(["a.txt"]);
    vi.advanceTimersByTime(5000);
    drop(["a.txt"]);

    drop(["a.txt"]);

    expect(onOpen).toHaveBeenCalledExactlyOnceWith([
      { hostPath: "a.txt", isFolder: false },
    ]);
  });
});
