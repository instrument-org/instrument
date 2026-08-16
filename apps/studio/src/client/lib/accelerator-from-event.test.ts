import { acceleratorFromEvent } from "@/client/lib/accelerator-from-event";
import { describe, expect, it } from "vitest";

const press = (
  code: string,
  modifiers: Partial<
    Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
  > = {},
) => ({
  altKey: false,
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("acceleratorFromEvent", () => {
  it.each([
    ["Space", { altKey: true }, "Alt+Space"],
    ["KeyK", { metaKey: true }, "Command+K"],
    ["KeyJ", { metaKey: true, shiftKey: true }, "Shift+Command+J"],
    ["Digit1", { ctrlKey: true }, "Control+1"],
    ["ArrowUp", { metaKey: true }, "Command+Up"],
    ["F5", { altKey: true }, "Alt+F5"],
    ["Slash", { metaKey: true }, "Command+/"],
    [
      "KeyA",
      { altKey: true, ctrlKey: true, metaKey: true, shiftKey: true },
      "Control+Alt+Shift+Command+A",
    ],
  ])("maps %s to an accelerator", (code, modifiers, expected) => {
    expect(
      acceleratorFromEvent(press(code, modifiers), { isMac: true }),
    ).toEqual({ accelerator: expected, kind: "ok" });
  });

  it("names the Windows key Super off macOS", () => {
    expect(
      acceleratorFromEvent(press("KeyK", { metaKey: true }), { isMac: false }),
    ).toMatchInlineSnapshot(`
        {
          "accelerator": "Super+K",
          "kind": "ok",
        }
      `);
  });

  // The chord is named after the physical key, not the character the modifiers
  // produced: Option+S types "ß" on a US Mac layout.
  it("ignores the character the modifiers produced", () => {
    expect(
      acceleratorFromEvent(press("KeyS", { altKey: true }), { isMac: true }),
    ).toEqual({ accelerator: "Alt+S", kind: "ok" });
  });

  it("keeps waiting while only a modifier is held", () => {
    expect(
      acceleratorFromEvent(press("MetaLeft", { metaKey: true }), {
        isMac: true,
      }),
    ).toEqual({ kind: "incomplete" });
  });

  it("refuses a bare key, which would be taken from every app", () => {
    expect(acceleratorFromEvent(press("KeyK"), { isMac: true }))
      .toMatchInlineSnapshot(`
        {
          "kind": "unsupported",
          "reason": "Use at least one modifier, like ⌘ or ⌥.",
        }
      `);
  });

  it("refuses a key it has no Electron name for", () => {
    expect(
      acceleratorFromEvent(press("MediaPlayPause", { metaKey: true }), {
        isMac: true,
      }),
    ).toEqual({
      kind: "unsupported",
      reason: "That key can't be part of a shortcut.",
    });
  });
});
