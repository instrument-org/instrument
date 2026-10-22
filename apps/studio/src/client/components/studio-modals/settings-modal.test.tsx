import { settingsModalAtom, openSettings } from "@/client/atoms/settings-modal";
import { modalBackStackAtom } from "@/client/atoms/tab-navigation-block";
import { renderWithDefaultStore } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { act, fireEvent, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsModal } from "./settings-modal";

vi.mock("@/client/hooks/use-developer-mode", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/hooks/use-developer-mode")
  >()),
  useDeveloperMode: () => true,
}));

// What the sidebar lists is decided before anything is read, so every query
// stays pending and the pages draw as they do while loading.
vi.mock("@/client/rpc/client", () => {
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: () => new Promise(() => undefined),
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({
            queryFn: () => new Promise(() => undefined),
            queryKey: path,
          });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({
            mutationFn: () => new Promise(() => undefined),
            ...options,
          });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { process: { platform } },
  });
}

afterEach(installWindowStubs);

describe("Settings sidebar in developer mode", () => {
  it.each([
    ["darwin", false],
    ["win32", false],
    ["linux", true],
  ] as const)("on %s lists Debug: %s", (platform, listed) => {
    setPlatform(platform);
    renderWithDefaultStore(<SettingsModal />);
    act(() => {
      openSettings({ tab: "Features" });
    });
    expect(screen.getByRole("button", { name: "Features" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Debug" }) !== null).toBe(
      listed,
    );
  });
});

describe("Settings pages", () => {
  const activePage = () =>
    screen
      .getAllByRole("button")
      .find((button) => button.dataset.active === "true")?.textContent;
  const back = () => {
    act(() => {
      getDefaultStore().get(modalBackStackAtom).at(-1)?.run();
    });
  };
  const forward = () => {
    act(() => {
      getDefaultStore().get(modalBackStackAtom).at(-1)?.forward();
    });
  };

  it("steps back through the pages visited, then closes", () => {
    setPlatform("darwin");
    renderWithDefaultStore(<SettingsModal />);
    act(() => {
      openSettings({ tab: "Features" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Storage" }));
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(activePage()).toBe("Memory");

    back();
    expect(activePage()).toBe("Storage");
    back();
    expect(activePage()).toBe("Features");
    back();
    expect(getDefaultStore().get(settingsModalAtom)).toBeNull();
  });

  it("steps forward again, until another page is chosen", () => {
    setPlatform("darwin");
    renderWithDefaultStore(<SettingsModal />);
    act(() => {
      openSettings({ tab: "Features" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Storage" }));
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    back();
    back();
    expect(activePage()).toBe("Features");

    forward();
    expect(activePage()).toBe("Storage");
    forward();
    expect(activePage()).toBe("Memory");
    forward();
    expect(activePage()).toBe("Memory");

    back();
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    forward();
    expect(activePage()).toBe("Skills");
    back();
    expect(activePage()).toBe("Storage");
  });

  it("opens each page at its top", () => {
    setPlatform("darwin");
    renderWithDefaultStore(<SettingsModal />);
    act(() => {
      openSettings({ tab: "Features" });
    });
    // jsdom lays nothing out, so it keeps no scroll offset of its own.
    const scroller = screen.getByRole("main");
    Object.defineProperty(scroller, "scrollTop", {
      value: 400,
      writable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Storage" }));
    // A page gets a scroller of its own, so it never inherits one's offset
    // or the edge fade a longer page left on it.
    expect(screen.getByRole("main")).not.toBe(scroller);
    expect(screen.getByRole("main").scrollTop).toBe(0);
  });
});
