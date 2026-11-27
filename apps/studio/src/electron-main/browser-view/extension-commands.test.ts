import { matchesAccelerator } from "@/electron-main/menus/match-accelerator";
import { describe, expect, it } from "vitest";

import {
  acceleratorOfShortcut,
  assignCommands,
  collidesWith,
  reportedCommand,
} from "./extension-commands";

describe("acceleratorOfShortcut", () => {
  it.each([
    ["Ctrl+Shift+Y", "Command+Shift+Y", "Control+Shift+Y"],
    ["Alt+Shift+P", "Alt+Shift+P", "Alt+Shift+P"],
    ["Command+Shift+U", "Command+Shift+U", null],
    ["MacCtrl+Space", "Control+Space", null],
    ["Ctrl+Comma", "Command+,", "Control+,"],
    ["Ctrl+Period", "Command+.", "Control+."],
    ["Alt+Up", "Alt+Up", "Alt+Up"],
    ["Ctrl+e", "Command+E", "Control+E"],
    ["Ctrl+1", "Command+1", "Control+1"],
    ["MediaPlayPause", "MediaPlayPause", "MediaPlayPause"],
    ["MediaPrevTrack", "MediaPreviousTrack", "MediaPreviousTrack"],
    // Chrome refuses each of these.
    ["Shift+Y", null, null],
    ["Y", null, null],
    ["Ctrl+Alt+Y", null, null],
    ["Ctrl+Ctrl+Y", null, null],
    ["Ctrl+MediaStop", null, null],
    ["Ctrl+F5", null, null],
    ["Search+Y", null, null],
    ["", null, null],
  ])("reads %j as %j on a Mac and %j elsewhere", (shortcut, mac, other) => {
    expect(acceleratorOfShortcut(shortcut, "mac")).toBe(mac);
    expect(acceleratorOfShortcut(shortcut, "windows")).toBe(other);
  });

  it("is pressed by the keys Chrome would take for it", () => {
    const accelerator = acceleratorOfShortcut("Ctrl+Shift+Y", "mac") ?? "";
    const input = {
      alt: false,
      code: "KeyY",
      control: false,
      key: "Y",
      meta: true,
      shift: true,
    };
    expect(matchesAccelerator(input, accelerator, { isMac: true })).toBe(true);
    expect(
      matchesAccelerator({ ...input, shift: false }, accelerator, {
        isMac: true,
      }),
    ).toBe(false);
  });
});

describe("assignCommands", () => {
  it("gives each command its system's key, the first to load keeping one two ask for", () => {
    const first = {
      id: "first",
      manifest: {
        commands: {
          _execute_action: {
            suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" },
          },
          lock: { description: "Lock", suggested_key: "Alt+Shift+L" },
          unbound: { description: "No key" },
          refused: { suggested_key: { default: "Shift+Q" } },
        },
      },
    };
    const second = {
      id: "second",
      manifest: {
        commands: {
          clash: {
            description: "Same chord",
            suggested_key: { default: "Ctrl+Shift+Y" },
          },
          media: { suggested_key: "MediaPlayPause" },
        },
      },
    };
    expect(
      assignCommands(
        [first, second, { id: "none", manifest: null }],
        "mac",
      ).map(
        (command) =>
          `${command.extensionId} ${command.name} ${String(command.accelerator)}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "first _execute_action Command+Shift+Y",
        "first lock Alt+Shift+L",
        "first unbound null",
        "first refused null",
        "second clash null",
        "second media MediaPlayPause",
      ]
    `);
    expect(
      assignCommands([first, second], "linux").map((command) =>
        reportedCommand(command, "linux"),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "description": "",
          "name": "_execute_action",
          "shortcut": "Ctrl+Shift+Y",
        },
        {
          "description": "Lock",
          "name": "lock",
          "shortcut": "Alt+Shift+L",
        },
        {
          "description": "No key",
          "name": "unbound",
          "shortcut": "",
        },
        {
          "description": "",
          "name": "refused",
          "shortcut": "",
        },
        {
          "description": "Same chord",
          "name": "clash",
          "shortcut": "",
        },
        {
          "description": "",
          "name": "media",
          "shortcut": "MediaPlayPause",
        },
      ]
    `);
  });
});

describe("collidesWith", () => {
  it("finds an app chord the extension's key is pressed as", () => {
    expect(collidesWith("Command+Shift+T", ["CmdOrCtrl+Shift+T"], "mac")).toBe(
      true,
    );
    expect(collidesWith("Command+Shift+Y", ["CmdOrCtrl+T"], "mac")).toBe(false);
    expect(collidesWith("Control+T", ["CmdOrCtrl+T"], "mac")).toBe(false);
    expect(collidesWith("Control+T", ["CmdOrCtrl+T"], "windows")).toBe(true);
  });
});
