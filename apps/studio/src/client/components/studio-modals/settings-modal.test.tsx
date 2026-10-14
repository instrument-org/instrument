import { openSettings } from "@/client/atoms/settings-modal";
import { renderWithDefaultStore } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { act, screen } from "@testing-library/react";
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
