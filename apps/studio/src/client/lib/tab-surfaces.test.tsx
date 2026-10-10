import { describe, expect, it } from "vitest";

import { chooseTabSurface } from "./tab-surfaces";

// The window: the inbox beside a chat with its words and its pane, and a
// draft's window floating over the row with its words and its band.
function layout() {
  document.body.innerHTML = `
    <div id="inbox"><div id="row"></div></div>
    <main id="chat">
      <div id="words"><div id="composer"></div></div>
      <div id="pane"><div id="folder"></div></div>
    </main>
    <div id="draft">
      <div id="draft-words"></div>
      <div id="band"><div id="band-page"></div></div>
    </div>
  `;
  const at = (id: string) => {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(id);
    }
    return element;
  };
  const entry = (
    name: string,
    surface: string,
    tabs: string,
    overrides: Partial<{ holdsKeyboard: boolean; visible: boolean }> = {},
  ) => ({
    holdsKeyboard: false,
    name,
    surface: at(surface),
    tabs: at(tabs),
    visible: true,
    ...overrides,
  });
  return { at, entry };
}

const chosen = (entry: { isInTabs: boolean; name: string } | undefined) =>
  entry && `${entry.name}${entry.isInTabs ? " tabs" : " words"}`;

describe("chooseTabSurface", () => {
  it.each([
    ["composer", "chat words"],
    ["folder", "chat tabs"],
    ["draft-words", "draft words"],
    ["band-page", "draft tabs"],
    ["row", undefined],
  ])("from %s picks %s", (place, expected) => {
    const { at, entry } = layout();
    const entries = [
      entry("chat", "chat", "pane"),
      entry("draft", "draft", "band"),
    ];
    expect(chosen(chooseTabSurface(entries, at(place)))).toBe(expected);
  });

  it("leaves the window's own chord with the keyboard nowhere", () => {
    const { entry } = layout();
    expect(chooseTabSurface([entry("chat", "chat", "pane")], null)).toBe(
      undefined,
    );
  });

  it("picks the surface whose page holds the keyboard, in its tabs", () => {
    const { at, entry } = layout();
    const entries = [
      entry("chat", "chat", "pane"),
      entry("draft", "draft", "band", { holdsKeyboard: true }),
    ];
    expect(chosen(chooseTabSurface(entries, at("composer")))).toBe(
      "draft tabs",
    );
  });

  it("passes over a surface in a window tab that is not up", () => {
    const { at, entry } = layout();
    const entries = [entry("chat", "chat", "pane", { visible: false })];
    expect(chooseTabSurface(entries, at("folder"))).toBe(undefined);
  });
});
