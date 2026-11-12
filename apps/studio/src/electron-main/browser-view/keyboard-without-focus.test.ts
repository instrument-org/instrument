import type { Protocol } from "devtools-protocol";

import { describe, expect, it } from "vitest";

import { electronKeyEvents, lastKeyEvent } from "./keyboard-without-focus";

// What agent-browser's `press` sends for a key: a keyDown carrying the text
// the key types (none under Control or Meta), then a keyUp.
function press(
  key: string,
  code: string,
  text?: string,
  modifiers = 0,
): [
  Protocol.Input.DispatchKeyEventRequest,
  Protocol.Input.DispatchKeyEventRequest,
] {
  return [
    { code, key, modifiers, text, type: "keyDown", unmodifiedText: text },
    { code, key, modifiers, type: "keyUp" },
  ];
}

const shown = (events: ReturnType<typeof electronKeyEvents>) =>
  events
    ? events
        .map(
          (event) =>
            `${event.type}:${JSON.stringify(event.keyCode)}${event.modifiers?.length ? `+${event.modifiers.join("+")}` : ""}`,
        )
        .join(" ")
    : "focus-taking path";

describe("electronKeyEvents", () => {
  it("carries the keys agent-browser presses, as Electron events", () => {
    const keys: Record<string, ReturnType<typeof press>> = {
      "!": press("!", "Digit1", "!"),
      A: press("A", "KeyA", "A"),
      ArrowLeft: press("ArrowLeft", "ArrowLeft"),
      Backspace: press("Backspace", "Backspace"),
      Enter: press("Enter", "Enter", "\r"),
      Escape: press("Escape", "Escape"),
      F5: press("F5", "F5"),
      "Shift+ArrowLeft": press("ArrowLeft", "ArrowLeft", undefined, 8),
      "Shift+Enter": press("Enter", "Enter", "\r", 8),
      "Shift+Tab": press("Tab", "Tab", "\t", 8),
      Space: press(" ", "Space", " "),
      Tab: press("Tab", "Tab", "\t"),
      a: press("a", "KeyA", "a"),
    };
    expect(
      Object.fromEntries(
        Object.entries(keys).map(([name, [down, up]]) => [
          name,
          `${shown(electronKeyEvents(down))} | ${shown(electronKeyEvents(up))}`,
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "!": "keyDown:"!" char:"!" | keyUp:"!"",
        "A": "keyDown:"A"+shift char:"A"+shift | keyUp:"A"+shift",
        "ArrowLeft": "keyDown:"Left" | keyUp:"Left"",
        "Backspace": "keyDown:"Backspace" | keyUp:"Backspace"",
        "Enter": "keyDown:"Enter" char:"\\r" | keyUp:"Enter"",
        "Escape": "keyDown:"Escape" | keyUp:"Escape"",
        "F5": "keyDown:"F5" | keyUp:"F5"",
        "Shift+ArrowLeft": "keyDown:"Left"+shift | keyUp:"Left"+shift",
        "Shift+Enter": "keyDown:"Enter"+shift char:"\\r"+shift | keyUp:"Enter"+shift",
        "Shift+Tab": "keyDown:"Tab"+shift char:"\\t"+shift | keyUp:"Tab"+shift",
        "Space": "keyDown:"Space" char:" " | keyUp:"Space"",
        "Tab": "keyDown:"Tab" char:"\\t" | keyUp:"Tab"",
        "a": "keyDown:"a" char:"a" | keyUp:"a"",
      }
    `);
  });

  it.each([
    ["Control+a", press("a", "KeyA", undefined, 2)[0]],
    ["Meta+a", press("a", "KeyA", undefined, 4)[0]],
    ["Alt+ArrowLeft", press("ArrowLeft", "ArrowLeft", undefined, 1)[0]],
    [
      "an event with editing commands",
      { ...press("a", "KeyA", "a")[0], commands: ["selectAll"] },
    ],
    ["a key outside US layout", press("é", "KeyE", "é")[0]],
    ["a modifier on its own", press("Shift", "ShiftLeft")[0]],
    ["text the key would not type", press("a", "KeyA", "b")[0]],
  ])("leaves %s to the focus-taking path", (_, params) => {
    expect(electronKeyEvents(params)).toBeUndefined();
  });

  it("sends a raw key down without its character", () => {
    expect(
      shown(
        electronKeyEvents({
          key: "Enter",
          text: "\r",
          type: "rawKeyDown",
        }),
      ),
    ).toBe('keyDown:"Enter"');
  });
});

describe("lastKeyEvent", () => {
  it.each([
    [press("Enter", "Enter", "\r")[0], "keypress"],
    [press("a", "KeyA", "a")[0], "keypress"],
    [press(" ", "Space", " ")[0], "keypress"],
    [press("Tab", "Tab", "\t")[0], "keydown"],
    [press("Backspace", "Backspace")[0], "keydown"],
    [press("a", "KeyA", undefined, 2)[0], "keydown"],
    [press("a", "KeyA", "a")[1], "keyup"],
    [{ key: "Enter", text: "\r", type: "rawKeyDown" as const }, "keydown"],
  ])("waits on the last event %# produces", (params, last) => {
    expect(lastKeyEvent(params)).toBe(last);
  });
});
