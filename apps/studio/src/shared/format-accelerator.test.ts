import { type Os } from "@/shared/os-conventions";
import { SHORTCUT_GUIDE_ENTRIES } from "@/shared/shortcut-guide";
import { type ShortcutAccelerator } from "@/shared/shortcuts";
import { describe, expect, it } from "vitest";

import { formatAcceleratorFor } from "./format-accelerator";

const OSES: Os[] = ["mac", "windows", "linux"];

/** An accelerator as each system writes it, Mac / Windows / Linux. */
const written = (accelerator: ShortcutAccelerator) =>
  OSES.map((os) => formatAcceleratorFor({ accelerator, os }).join(" ")).join(
    "  /  ",
  );

// One row per accelerator, every system, so a mapping change shows up as one
// readable diff instead of a snapshot per case (inline snapshots and `it.each`
// share a call site and overwrite each other).
const everySystem = (accelerators: string[]) =>
  accelerators.map(
    (accelerator) => `${accelerator}  ->  ${written(accelerator)}`,
  );

describe("formatAcceleratorFor", () => {
  it("formats the accelerator shapes the table uses", () => {
    expect(
      everySystem([
        "CmdOrCtrl+T",
        "CmdOrCtrl+Shift+T",
        "Ctrl+Shift+Tab",
        "CmdOrCtrl+Plus",
        "CmdOrCtrl+-",
        "CmdOrCtrl+,",
        "CmdOrCtrl+1…8",
        "Alt+Left",
        "Super+K",
        "?",
        "F11",
      ]),
    ).toMatchInlineSnapshot(`
      [
        "CmdOrCtrl+T  ->  ⌘ T  /  Ctrl T  /  Ctrl T",
        "CmdOrCtrl+Shift+T  ->  ⇧ ⌘ T  /  Ctrl Shift T  /  Ctrl Shift T",
        "Ctrl+Shift+Tab  ->  ⌃ ⇧ Tab  /  Ctrl Shift Tab  /  Ctrl Shift Tab",
        "CmdOrCtrl+Plus  ->  ⌘ +  /  Ctrl +  /  Ctrl +",
        "CmdOrCtrl+-  ->  ⌘ -  /  Ctrl -  /  Ctrl -",
        "CmdOrCtrl+,  ->  ⌘ ,  /  Ctrl ,  /  Ctrl ,",
        "CmdOrCtrl+1…8  ->  ⌘ 1…8  /  Ctrl 1…8  /  Ctrl 1…8",
        "Alt+Left  ->  ⌥ ←  /  Alt ←  /  Alt ←",
        "Super+K  ->  ⌘ K  /  Win K  /  Super K",
        "?  ->  ?  /  ?  /  ?",
        "F11  ->  F11  /  F11  /  F11",
      ]
    `);
  });

  it("picks the platform's chord when the two differ", () => {
    const accelerator = { darwin: "Control+Command+F", default: "F11" };
    expect(formatAcceleratorFor({ accelerator, os: "mac" }))
      .toMatchInlineSnapshot(`
      [
        "⌃",
        "⌘",
        "F",
      ]
    `);
    expect(formatAcceleratorFor({ accelerator, os: "windows" }))
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
        os: "mac",
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

  // The shortcut guide's whole table, which is every chord the app window
  // answers to, as each system shows it.
  it("renders every shortcut in the guide", () => {
    expect(
      SHORTCUT_GUIDE_ENTRIES.map(
        ({ accelerator, id }) => `${id}: ${written(accelerator)}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "shortcutGuide: ?  /  ?  /  ?",
        "pasteAsText: ⇧ ⌘ V  /  Ctrl Shift V  /  Ctrl Shift V",
        "nextChatInList: ↓  /  ↓  /  ↓",
        "previousChatInList: ↑  /  ↑  /  ↑",
        "replyFromList: ↩  /  Enter  /  Enter",
        "backToList: Esc  /  Esc  /  Esc",
        "pageForward: →  /  →  /  →",
        "pageBack: ←  /  ←  /  ←",
        "pageScroll: Space  /  Space  /  Space",
        "pageClose: Esc  /  Esc  /  Esc",
        "back: ⌘ [  /  Alt ←  /  Alt ←",
        "closeTab: ⌘ W  /  Ctrl W  /  Ctrl W",
        "commandMenu: ⌘ K  /  Ctrl K  /  Ctrl K",
        "editPage: ⌘ E  /  Ctrl E  /  Ctrl E",
        "findInPage: ⌘ F  /  Ctrl F  /  Ctrl F",
        "findNext: ⌘ G  /  Ctrl G  /  Ctrl G",
        "findPrevious: ⇧ ⌘ G  /  Ctrl Shift G  /  Ctrl Shift G",
        "forward: ⌘ ]  /  Alt →  /  Alt →",
        "goToApps: ⌃ ⌘ 4  /  Alt 4  /  Alt 4",
        "goToBrowser: ⌃ ⌘ 3  /  Alt 3  /  Alt 3",
        "goToChat: ⌃ ⌘ 1  /  Alt 1  /  Alt 1",
        "goToFiles: ⌃ ⌘ 2  /  Alt 2  /  Alt 2",
        "newChat: ⌘ N  /  Ctrl N  /  Ctrl N",
        "newTab: ⌘ T  /  Ctrl T  /  Ctrl T",
        "nextChat: ⌥ ⌘ ↓  /  Alt Shift ↓  /  Alt Shift ↓",
        "nextTab: ⌃ Tab  /  Ctrl Tab  /  Ctrl Tab",
        "previousChat: ⌥ ⌘ ↑  /  Alt Shift ↑  /  Alt Shift ↑",
        "previousTab: ⌃ ⇧ Tab  /  Ctrl Shift Tab  /  Ctrl Shift Tab",
        "printPage: ⌘ P  /  Ctrl P  /  Ctrl P",
        "reloadPage: ⌘ R  /  Ctrl R  /  Ctrl R",
        "reopenTab: ⇧ ⌘ T  /  Ctrl Shift T  /  Ctrl Shift T",
        "search: ⌘ L  /  Ctrl L  /  Ctrl L",
        "toggleInbox: ⌘ B  /  Ctrl B  /  Ctrl B",
        "actualSize: ⌘ 0  /  Ctrl 0  /  Ctrl 0",
        "closeWindow: ⇧ ⌘ W  /  Ctrl Shift W  /  Ctrl Shift W",
        "lastTab: ⌘ 9  /  Ctrl 9  /  Ctrl 9",
        "quit: ⌘ Q  /  Ctrl Q  /  Ctrl Q",
        "tabByPlace: ⌘ 1…8  /  Ctrl 1…8  /  Ctrl 1…8",
        "toggleFullScreen: ⌃ ⌘ F  /  F11  /  F11",
        "zoomIn: ⌘ +  /  Ctrl =  /  Ctrl =",
        "zoomOut: ⌘ -  /  Ctrl -  /  Ctrl -",
        "reloadApp: ⇧ ⌘ R  /  Ctrl Shift R  /  Ctrl Shift R",
        "settings: ⌘ ,  /  Ctrl ,  /  Ctrl ,",
        "themeDark: ⇧ ⌘ D  /  Ctrl Shift D  /  Ctrl Shift D",
        "themeLight: ⇧ ⌘ L  /  Ctrl Shift L  /  Ctrl Shift L",
        "themeSystem: ⇧ ⌘ M  /  Ctrl Shift M  /  Ctrl Shift M",
      ]
    `);
  });

  // The product guide writes one column for both, so a chord that differs
  // between them has to change how it is written there first.
  it("writes every guide chord alike on Windows and Linux", () => {
    const differ = SHORTCUT_GUIDE_ENTRIES.filter(
      ({ accelerator }) =>
        formatAcceleratorFor({ accelerator, os: "windows" }).join("+") !==
        formatAcceleratorFor({ accelerator, os: "linux" }).join("+"),
    );
    expect(differ).toEqual([]);
  });
});
