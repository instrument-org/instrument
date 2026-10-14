import { zoomAtom } from "@/client/atoms/zoom";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { ariaSnapshot } from "@/tests/aria-snapshot";
import { renderInBrowser } from "@/tests/render-browser";
import { createStore } from "jotai";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AppErrorFallback } from "./app-error-fallback";

// No main process here. The window controls read the window's state and the
// report button reads whether reports send automatically; these tests only
// need both to render.
vi.mock("@/client/rpc/client", () => {
  const live = (key: string, data: unknown) => ({
    experimental_liveOptions: () => ({ queryFn: () => data, queryKey: [key] }),
  });
  const mutation = { mutationOptions: () => ({ mutationFn: vi.fn() }) };
  return {
    rpcClient: {
      preferences: { live: { get: live("preferences", {}) } },
      utils: {
        closeWindow: mutation,
        live: { windowState: live("windowState", { maximized: false }) },
        minimizeWindow: mutation,
        toggleMaximizeWindow: mutation,
      },
    },
  };
});

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { process: { platform } },
  });
}

afterEach(() => {
  setPlatform("darwin");
});

/**
 * A crash in the app window's shell puts this in place of the whole window,
 * bar included. On Windows and Linux the window is frameless and draws its
 * own buttons in that bar, so a fallback without them is a window that can be
 * neither moved nor closed until it reloads.
 */
describe("AppErrorFallback", () => {
  test.each(["win32", "linux"] as const)(
    "keeps the window's own buttons on %s",
    async (platform) => {
      setPlatform(platform);
      const { locator } = await renderInBrowser(
        <AppErrorFallback error={new Error("Simulated render crash")} />,
      );

      await expect(ariaSnapshot(locator)).resolves.toMatchInlineSnapshot(`
        "- button "Minimize"
        - button "Maximize"
        - button "Close"
        - text: Something went wrong The app hit an unexpected error. Reload to recover, or send us a report if it keeps happening.
        - button "Copy"
        - text: Simulated render crash
        - button "Error detail"
        - button "Reload"
        - button "Send a report""
      `);
    },
  );

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
