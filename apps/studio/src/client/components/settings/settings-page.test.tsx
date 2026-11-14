import { renderWithDefaultStore } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./settings-page";

vi.mock("@/client/hooks/use-developer-mode", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/hooks/use-developer-mode")
  >()),
  useDeveloperMode: () => true,
}));

// What the sidebar lists is decided before anything is read, so every query
// stays pending and the parts draw as they do while loading.
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

/** Lays every element out this wide, as jsdom lays out nothing. */
function setWidth(px: number) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(px);
}

afterEach(() => {
  vi.restoreAllMocks();
  installWindowStubs();
});

const page = (props: Partial<Parameters<typeof SettingsPage>[0]> = {}) => (
  <SettingsPage
    ask={null}
    onOpenPage={() => undefined}
    onSearch={() => undefined}
    onSection={() => undefined}
    q=""
    section="Developer"
    {...props}
  />
);

const activePart = () =>
  screen
    .getAllByRole("button")
    .find((button) => button.dataset.active === "true");

describe("Settings sidebar in developer mode", () => {
  it.each(["darwin", "win32", "linux"] as const)("on %s", (platform) => {
    setPlatform(platform);
    setWidth(1000);
    renderWithDefaultStore(page());
    expect(screen.getByRole("button", { name: "Developer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Debug" })).toBeNull();
  });
});

describe("Settings parts", () => {
  it.each([
    ["names each part beside it", 1000, "Developer"],
    ["folds to a rail of icons, each named for its part", 500, ""],
  ])("%s", (_case, width, text) => {
    setPlatform("darwin");
    setWidth(width);
    renderWithDefaultStore(page());
    expect(activePart()?.getAttribute("aria-label") ?? "Developer").toBe(
      "Developer",
    );
    expect(activePart()?.textContent).toBe(text);
    expect(screen.queryByRole("button", { name: "Memory" })).toBeNull();
  });

  it("asks for the part picked, wide or folded", () => {
    setPlatform("darwin");
    for (const width of [1000, 500]) {
      setWidth(width);
      const onSection = vi.fn();
      const { unmount } = renderWithDefaultStore(page({ onSection }));
      fireEvent.click(screen.getByRole("button", { name: "Storage" }));
      expect(onSection).toHaveBeenCalledWith("Storage");
      unmount();
    }
  });

  it("opens each part at its top", () => {
    setPlatform("darwin");
    setWidth(1000);
    const { rerender } = renderWithDefaultStore(page());
    // jsdom lays nothing out, so it keeps no scroll offset of its own.
    const scroller = screen.getByRole("main");
    Object.defineProperty(scroller, "scrollTop", {
      value: 400,
      writable: true,
    });
    rerender(page({ section: "Storage" }));
    // A part gets a scroller of its own, so it never inherits one's offset
    // or the edge fade a longer part left on it.
    expect(screen.getByRole("main")).not.toBe(scroller);
    expect(screen.getByRole("main").scrollTop).toBe(0);
  });
});
