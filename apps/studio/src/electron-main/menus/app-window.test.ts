import { CODE_EDITOR_FOCUS_CHANNEL } from "@/shared/constants";
import { type Input, type WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: () => null },
}));
const publish = vi.hoisted(() =>
  vi.fn<(name: string, data: unknown) => void>(),
);
vi.mock("@/electron-main/rpc/publisher", () => ({ publisher: { publish } }));
vi.mock("@/electron-main/stores/workspace/preferences", () => ({
  isDeveloperMode: () => false,
}));
vi.mock("@/electron-main/lib/setup-state", () => ({ isSetupUp: () => false }));
vi.mock("./other-window", () => ({}));
vi.mock("./utils", () => ({}));

const PLATFORM = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: PLATFORM });
});

type Press = Pick<Input, "alt" | "code" | "control" | "key" | "meta" | "shift">;

/**
 * The window's chord binder as it loads on `platform`, bound to a stand-in
 * for the window's web contents that takes key presses and the renderer's
 * word on a code editor's focus.
 */
async function windowOn(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
  vi.resetModules();
  const { bindAppWindowChords } = await import("./app-window");
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const ipc = new Map<string, (...args: unknown[]) => void>();
  const webContents = {
    ipc: {
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        ipc.set(channel, listener);
      },
    },
    on: (name: string, listener: (...args: unknown[]) => void) => {
      listeners.set(name, listener);
    },
  };
  // A stand-in with only the two ways the binder listens, not a WebContents.
  bindAppWindowChords(webContents as unknown as WebContents);
  return {
    focusCodeEditor: (focused: boolean) => {
      ipc.get(CODE_EDITOR_FOCUS_CHANNEL)?.({}, focused);
    },
    navigate: () => {
      listeners.get("did-navigate")?.();
    },
    /** The command a press ran, or null when it went on to the page. */
    press: (input: Press) => {
      publish.mockClear();
      const event = { preventDefault: vi.fn() };
      listeners.get("before-input-event")?.(event, {
        ...input,
        type: "keyDown",
      });
      const ran = publish.mock.calls[0]?.[1] ?? null;
      expect(event.preventDefault).toHaveBeenCalledTimes(ran === null ? 0 : 1);
      return ran;
    },
  };
}

function press(key: string, code: string, ...held: (keyof Press)[]): Press {
  return {
    alt: held.includes("alt"),
    code,
    control: held.includes("control"),
    key,
    meta: held.includes("meta"),
    shift: held.includes("shift"),
  };
}

describe("a window chord that is also a code editor's key", () => {
  it.each([
    {
      back: press("ArrowLeft", "ArrowLeft", "alt"),
      nextChat: press("ArrowDown", "ArrowDown", "alt", "shift"),
      newTab: press("t", "KeyT", "control"),
      platform: "win32",
    },
    {
      back: press("ArrowLeft", "ArrowLeft", "alt"),
      nextChat: press("ArrowDown", "ArrowDown", "alt", "shift"),
      newTab: press("t", "KeyT", "control"),
      platform: "linux",
    },
    {
      back: press("[", "BracketLeft", "meta"),
      nextChat: press("ArrowDown", "ArrowDown", "alt", "meta"),
      newTab: press("t", "KeyT", "meta"),
      platform: "darwin",
    },
  ] as const)(
    "goes on to a focused code editor on $platform, and only then",
    async ({ back, newTab, nextChat, platform }) => {
      const window = await windowOn(platform);
      expect(window.press(back)).toBe("back");
      expect(window.press(nextChat)).toBe("nextChat");

      window.focusCodeEditor(true);
      expect(window.press(back)).toBeNull();
      expect(window.press(nextChat)).toBeNull();
      // A chord the editor has no key for stays the window's.
      expect(window.press(newTab)).toBe("newTab");

      window.focusCodeEditor(false);
      expect(window.press(back)).toBe("back");

      // A page loaded afresh has no editor holding the keyboard.
      window.focusCodeEditor(true);
      window.navigate();
      expect(window.press(nextChat)).toBe("nextChat");
    },
  );
});
