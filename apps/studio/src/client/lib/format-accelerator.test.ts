import { SHORTCUT_ENTRIES } from "@/shared/shortcuts";
import { describe, expect, it } from "vitest";

import { formatAcceleratorFor } from "./format-accelerator";

// One row per accelerator, both platforms, so a mapping change shows up as one
// readable diff instead of a snapshot per case (inline snapshots and `it.each`
// share a call site and overwrite each other).
const bothPlatforms = (accelerators: string[]) =>
  accelerators.map(
    (accelerator) =>
      `${accelerator}  ->  ${formatAcceleratorFor({ accelerator, isMac: true }).join(" ")}  /  ${formatAcceleratorFor({ accelerator, isMac: false }).join(" ")}`,
  );

describe("formatAcceleratorFor", () => {
  it("formats the accelerator shapes the table uses", () => {
    expect(
      bothPlatforms([
        "CmdOrCtrl+T",
        "CmdOrCtrl+Shift+T",
        "Ctrl+Shift+Tab",
        "CmdOrCtrl+Plus",
        "CmdOrCtrl+-",
        "CmdOrCtrl+,",
        "CmdOrCtrl+1…8",
        "?",
        "F11",
      ]),
    ).toMatchInlineSnapshot(`
      [
        "CmdOrCtrl+T  ->  ⌘ T  /  Ctrl T",
        "CmdOrCtrl+Shift+T  ->  ⇧ ⌘ T  /  Ctrl Shift T",
        "Ctrl+Shift+Tab  ->  ⌃ ⇧ Tab  /  Ctrl Shift Tab",
        "CmdOrCtrl+Plus  ->  ⌘ +  /  Ctrl +",
        "CmdOrCtrl+-  ->  ⌘ -  /  Ctrl -",
        "CmdOrCtrl+,  ->  ⌘ ,  /  Ctrl ,",
        "CmdOrCtrl+1…8  ->  ⌘ 1…8  /  Ctrl 1…8",
        "?  ->  ?  /  ?",
        "F11  ->  F11  /  F11",
      ]
    `);
  });

  it("picks the platform's chord when the two differ", () => {
    const accelerator = { darwin: "Control+Command+F", default: "F11" };
    expect(formatAcceleratorFor({ accelerator, isMac: true }))
      .toMatchInlineSnapshot(`
      [
        "⌃",
        "⌘",
        "F",
      ]
    `);
    expect(formatAcceleratorFor({ accelerator, isMac: false }))
      .toMatchInlineSnapshot(`
      [
        "F11",
      ]
    `);
  });

  it("writes modifiers in the platform's canonical order", () => {
    expect(
      formatAcceleratorFor({
        accelerator: "Shift+Alt+CmdOrCtrl+Control+K",
        isMac: true,
      }),
    ).toMatchInlineSnapshot(`
      [
        "⌃",
        "⌥",
        "⇧",
        "⌘",
        "K",
      ]
    `);
  });

  it("renders every shortcut in the table", () => {
    expect(
      SHORTCUT_ENTRIES.map(
        ({ descriptor, id }) =>
          `${id}: ${formatAcceleratorFor({ accelerator: descriptor.accelerator, isMac: true }).join(" ")}  /  ${formatAcceleratorFor({ accelerator: descriptor.accelerator, isMac: false }).join(" ")}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "closeTab: ⌘ W  /  Ctrl W",
        "commandMenu: ⌘ K  /  Ctrl K",
        "findInPage: ⌘ F  /  Ctrl F",
        "goBack: ⌘ [  /  Ctrl [",
        "goForward: ⌘ ]  /  Ctrl ]",
        "newTab: ⌘ T  /  Ctrl T",
        "newTask: ⌘ N  /  Ctrl N",
        "reloadApp: ⇧ ⌘ R  /  Ctrl Shift R",
        "reloadPage: ⌘ R  /  Ctrl R",
        "reopenTab: ⇧ ⌘ T  /  Ctrl Shift T",
        "resetZoom: ⌘ 0  /  Ctrl 0",
        "selectLastTab: ⌘ 9  /  Ctrl 9",
        "selectNextTab: ⌃ Tab  /  Ctrl Tab",
        "selectPreviousTab: ⌃ ⇧ Tab  /  Ctrl Shift Tab",
        "selectTabByIndex: ⌘ 1…8  /  Ctrl 1…8",
        "settings: ⌘ ,  /  Ctrl ,",
        "shortcutGuide: ?  /  ?",
        "themeDark: ⇧ ⌘ D  /  Ctrl Shift D",
        "themeLight: ⇧ ⌘ L  /  Ctrl Shift L",
        "themeSystem: ⇧ ⌘ M  /  Ctrl Shift M",
        "toggleFullscreen: ⌃ ⌘ F  /  F11",
        "toggleSidebar: ⌘ B  /  Ctrl B",
        "toggleTaskPane: ⌥ ⌘ B  /  Ctrl Alt B",
        "zoomIn: ⌘ +  /  Ctrl +",
        "zoomOut: ⌘ -  /  Ctrl -",
      ]
    `);
  });
});
