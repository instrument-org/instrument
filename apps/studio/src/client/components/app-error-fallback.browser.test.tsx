import { zoomAtom } from "@/client/atoms/zoom";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { renderInBrowser } from "@/tests/render-browser";
import { createStore } from "jotai";
import { describe, expect, test, vi } from "vitest";

import { AppErrorFallback } from "./app-error-fallback";

// No main process here. The report button reads whether reports send automatically; these tests only
// need it to render.
vi.mock("@/client/rpc/client", () => {
  const live = (key: string, data: unknown) => ({
    experimental_liveOptions: () => ({ queryFn: () => data, queryKey: [key] }),
  });
  return {
    rpcClient: {
      preferences: { live: { get: live("preferences", {}) } },
    },
  };
});

describe("AppErrorFallback", () => {
  // Read off the point rather than off a class, since what the system acts on
  // is whatever is under the pointer. At 2x the band is twice as tall on
  // screen, which is the height the main process centers the macOS traffic
  // lights in.
  test.each([1, 2])("drags by the band across the top at %sx", async (zoom) => {
    const store = createStore();
    store.set(zoomAtom, zoom);
    await renderInBrowser(
      <AppErrorFallback error={new Error("Simulated render crash")} />,
      { store },
    );

    const regionAt = (y: number) => {
      const element = document.elementFromPoint(window.innerWidth / 2, y);
      if (!element) {
        throw new Error(`nothing at y=${y}`);
      }
      return getComputedStyle(element).getPropertyValue("-webkit-app-region");
    };

    expect(regionAt(TOOLBAR_HEIGHT * zoom - 2)).toBe("drag");
    expect(regionAt(TOOLBAR_HEIGHT * zoom + 2)).not.toBe("drag");
  });
});
