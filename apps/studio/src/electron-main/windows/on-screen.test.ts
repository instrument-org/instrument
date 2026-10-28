import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toolkit = vi.hoisted(() => ({ is: { dev: false } }));
vi.mock("@electron-toolkit/utils", () => toolkit);
vi.mock("electron", () => ({ default: {} }));

// How a window comes on screen decides whether booting or relaunching the app
// takes the keyboard from whatever the person is typing in. A development run
// relaunches on every main-process rebuild, and an agent's instance boots
// beside the person's own work, so neither may take focus; only a packaged
// build comes forward with it.

function fakeWindow() {
  const calls: string[] = [];
  return {
    calls,
    window: {
      isDestroyed: () => false,
      maximize: () => calls.push("maximize"),
      minimize: () => calls.push("minimize"),
      show: () => calls.push("show"),
      showInactive: () => calls.push("showInactive"),
    },
  };
}

async function load({
  dev,
  env = {},
}: {
  dev: boolean;
  env?: Record<string, string>;
}) {
  toolkit.is.dev = dev;
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return import("./on-screen");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("putting a window on screen", () => {
  it("brings a packaged build's window forward with focus", async () => {
    const { putOnScreen } = await load({ dev: false });
    const { calls, window } = fakeWindow();
    putOnScreen(window);
    expect(calls).toEqual(["show"]);
  });

  it("brings a development run's window up without focus", async () => {
    const { putOnScreen } = await load({ dev: true });
    const { calls, window } = fakeWindow();
    putOnScreen(window, { maximized: true });
    expect(calls).toEqual(["maximize", "showInactive"]);
  });

  it("holds an agent's instance off screen until its Dock icon is clicked", async () => {
    const { isDrivenInstance, isHeldOffScreen, putOnScreen, showHeldWindows } =
      await load({ dev: true, env: { STUDIO_DRIVE_PURPOSE: "hotkeys" } });
    const { calls, window } = fakeWindow();
    putOnScreen(window, { maximized: true });
    expect(isDrivenInstance()).toBe(true);
    expect(calls).toEqual([]);
    expect(isHeldOffScreen(window)).toBe(true);

    expect(showHeldWindows()).toBe(true);
    expect(calls).toEqual(["maximize", "show"]);
    expect(isHeldOffScreen(window)).toBe(false);
    expect(showHeldWindows()).toBe(false);
  });

  it("puts an agent's instance booted with --visible up without focus", async () => {
    const { putOnScreen } = await load({
      dev: true,
      env: { STUDIO_DRIVE_PURPOSE: "hotkeys", STUDIO_DRIVE_VISIBLE: "1" },
    });
    const { calls, window } = fakeWindow();
    putOnScreen(window);
    expect(calls).toEqual(["showInactive"]);
  });

  it.each([
    ["front", ["maximize", "showInactive"], false],
    ["minimized", ["minimize"], false],
    ["hidden", [], true],
  ] as const)(
    "brings a packaged build's window back %s after an automatic restart",
    async (view, expected, held) => {
      const { comeBackAsLeft, isHeldOffScreen, putOnScreen } = await load({
        dev: false,
      });
      comeBackAsLeft(view);
      const first = fakeWindow();
      putOnScreen(first.window, { maximized: true });
      expect(first.calls).toEqual(expected);
      expect(isHeldOffScreen(first.window)).toBe(held);

      // Only the first window: a later one opens as on any launch.
      const later = fakeWindow();
      putOnScreen(later.window);
      expect(later.calls).toEqual(["show"]);
    },
  );

  it("ignores the agent's variables in a packaged build", async () => {
    const { isDrivenInstance, putOnScreen } = await load({
      dev: false,
      env: { STUDIO_DRIVE_PURPOSE: "hotkeys" },
    });
    const { calls, window } = fakeWindow();
    putOnScreen(window);
    expect(isDrivenInstance()).toBe(false);
    expect(calls).toEqual(["show"]);
  });
});
