import { type MenuItemConstructorOptions, type WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";

import { attachGuestInteractions } from "./guest-interactions";

const { buildFromTemplate } = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((_template: MenuItemConstructorOptions[]) => ({
    popup: vi.fn(),
  })),
}));

vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn() },
  Menu: { buildFromTemplate },
}));
vi.mock("@/electron-main/lib/open-external", () => ({
  openExternal: vi.fn(),
}));
vi.mock("@/electron-main/stores/workspace/preferences", () => ({
  isDeveloperMode: () => false,
}));
const { saveAsFromPage } = vi.hoisted(() => ({ saveAsFromPage: vi.fn() }));
vi.mock("./downloads", () => ({ saveAsFromPage }));

const CAT = "https://example.com/cat.jpg";

// Electron's event payloads are far wider than the handful of fields the menu
// reads, so the doubles carry those fields and are shaped on the way in.
function buildMenu(linkURL: string, params: Record<string, unknown> = {}) {
  const handlers = new Map<string, (event: unknown, params: unknown) => void>();
  const loadURL = vi.fn(() => Promise.resolve());
  const openInNewTab = vi.fn();
  const step = vi.fn();
  const goBack = vi.fn();
  const copyImageAt = vi.fn();
  const replaceMisspelling = vi.fn();
  const addWordToSpellCheckerDictionary = vi.fn();
  const guest = {
    copyImageAt,
    executeJavaScript: vi.fn(() => Promise.resolve()),
    loadURL,
    navigationHistory: {
      canGoBack: () => true,
      canGoForward: () => false,
      goBack,
    },
    on: (event: string, handler: (event: unknown, params: unknown) => void) => {
      handlers.set(event, handler);
    },
    reload: vi.fn(),
    replaceMisspelling,
    session: { addWordToSpellCheckerDictionary },
  } as unknown as WebContents;

  attachGuestInteractions(guest, { mayOpen: () => true, openInNewTab, step });
  handlers.get("context-menu")?.(null, {
    dictionarySuggestions: [],
    editFlags: { canCopy: true, canCut: false, canPaste: false },
    hasImageContents: false,
    isEditable: false,
    linkURL,
    mediaType: "none",
    misspelledWord: "",
    selectionText: "",
    srcURL: "",
    x: 10,
    y: 20,
    ...params,
  });

  const items = buildFromTemplate.mock.lastCall?.[0] ?? [];
  const find = (label: string) => items.find((item) => item.label === label);
  // The handlers ignore every argument Electron passes them.
  const click = (label: string) => {
    (find(label)?.click as (() => void) | undefined)?.();
  };
  return {
    addWordToSpellCheckerDictionary,
    back: find("Back"),
    click,
    copyImageAt,
    find,
    goBack,
    labels: items.flatMap((item) => (item.label ? [item.label] : [])),
    // The menu as it reads, a separator drawn as a rule.
    lines: items.map((item) =>
      item.type === "separator"
        ? "---"
        : `${item.label ?? ""}${item.enabled === false ? " (disabled)" : ""}`,
    ),
    loadURL,
    replaceMisspelling,
    openInNewTab,
    openLink: items.find((item) => item.label === "Open Link"),
    openLinkInNewTab: items.find(
      (item) => item.label === "Open Link in New Tab",
    ),
    step,
  };
}

describe("the guest context menu", () => {
  it("offers Open Link for an http(s) link, above Copy Link", () => {
    const { labels } = buildMenu(
      "https://www.amazon.com/gp/product/B0B8F29SP8",
    );

    expect(labels).toContain("Open Link");
    expect(labels.indexOf("Open Link")).toBeLessThan(
      labels.indexOf("Copy Link"),
    );
  });

  it("navigates the guest itself, since it holds one page", () => {
    const { loadURL, openLink } = buildMenu(
      "https://www.amazon.com/gp/product/B0B8F29SP8",
    );

    // The handler ignores every argument Electron passes it.
    (openLink?.click as (() => void) | undefined)?.();

    expect(loadURL).toHaveBeenCalledWith(
      "https://www.amazon.com/gp/product/B0B8F29SP8",
    );
  });

  it("offers the link in a tab of the window's own", () => {
    const { openInNewTab, openLinkInNewTab } = buildMenu(
      "file:///Users/me/site/b.html",
    );

    (openLinkInNewTab?.click as (() => void) | undefined)?.();

    expect(openInNewTab).toHaveBeenCalledWith("file:///Users/me/site/b.html");
  });

  // Back from a page's first entry is its tab's back (to the screen it was
  // opened from), which only the window knows; the menu asks the window.
  it("asks the window to step back rather than stepping the guest", () => {
    const { back, goBack, step } = buildMenu("");

    (back?.click as (() => void) | undefined)?.();

    expect(step).toHaveBeenCalledWith("back");
    expect(goBack).not.toHaveBeenCalled();
  });

  it("omits Open Link for a link the guest cannot navigate to", () => {
    const { labels } = buildMenu("mailto:someone@example.com");

    expect(labels).not.toContain("Open Link");
    expect(labels).toContain("Copy Link");
  });

  it("reads as a browser's over plain text", () => {
    expect(buildMenu("", { selectionText: "a cat" }).lines)
      .toMatchInlineSnapshot(`
      [
        "Back",
        "Forward (disabled)",
        "Reload",
        "---",
        "Cut (disabled)",
        "Copy",
        "Paste (disabled)",
        "---",
        "Select All",
      ]
    `);
  });

  it("offers an image's own items over an image", () => {
    expect(
      buildMenu("", { hasImageContents: true, mediaType: "image", srcURL: CAT })
        .lines,
    ).toMatchInlineSnapshot(`
      [
        "Back",
        "Forward (disabled)",
        "Reload",
        "---",
        "Open Image in New Tab",
        "Save Image As…",
        "Copy Image",
        "Copy Image Address",
        "---",
        "Copy",
      ]
    `);
  });

  it("puts the link's items above the image's over a linked image", () => {
    expect(
      buildMenu("https://example.com/cats", {
        hasImageContents: true,
        mediaType: "image",
        srcURL: CAT,
      }).lines,
    ).toMatchInlineSnapshot(`
      [
        "Back",
        "Forward (disabled)",
        "Reload",
        "---",
        "Open Link",
        "Open Link in New Tab",
        "Copy Link",
        "---",
        "Open Image in New Tab",
        "Save Image As…",
        "Copy Image",
        "Copy Image Address",
        "---",
        "Copy",
      ]
    `);
  });

  it("puts a misspelled word's suggestions at the top in a field", () => {
    expect(
      buildMenu("", {
        dictionarySuggestions: ["cat", "cast"],
        editFlags: { canCopy: true, canCut: true, canPaste: true },
        isEditable: true,
        misspelledWord: "caat",
        selectionText: "caat",
      }).lines,
    ).toMatchInlineSnapshot(`
      [
        "cat",
        "cast",
        "---",
        "Add to Dictionary",
        "---",
        "Back",
        "Forward (disabled)",
        "Reload",
        "---",
        "Cut",
        "Copy",
        "Paste",
        "---",
        "Select All",
      ]
    `);
  });

  it("says no guesses were found for a word with none", () => {
    const { find } = buildMenu("", {
      isEditable: true,
      misspelledWord: "qzxv",
      selectionText: "qzxv",
    });

    expect(find("No Guesses Found")?.enabled).toBe(false);
  });

  it("replaces the word, or adds it to the dictionary", () => {
    const { addWordToSpellCheckerDictionary, click, replaceMisspelling } =
      buildMenu("", {
        dictionarySuggestions: ["cat"],
        isEditable: true,
        misspelledWord: "caat",
        selectionText: "caat",
      });

    click("cat");
    click("Add to Dictionary");

    expect(replaceMisspelling).toHaveBeenCalledWith("cat");
    expect(addWordToSpellCheckerDictionary).toHaveBeenCalledWith("caat");
  });

  it("copies, saves and opens the image under the pointer", () => {
    const { click, copyImageAt, openInNewTab } = buildMenu("", {
      hasImageContents: true,
      mediaType: "image",
      srcURL: CAT,
    });

    click("Copy Image");
    click("Save Image As…");
    click("Open Image in New Tab");

    expect(copyImageAt).toHaveBeenCalledWith(10, 20);
    expect(saveAsFromPage).toHaveBeenCalledWith(expect.anything(), CAT);
    expect(openInNewTab).toHaveBeenCalledWith(CAT);
  });

  it("disables Copy Image for an image that has not loaded", () => {
    const { find } = buildMenu("", { mediaType: "image", srcURL: CAT });

    expect(find("Copy Image")?.enabled).toBe(false);
  });

  it("offers a video's address and a save, with no copy of its picture", () => {
    const { labels } = buildMenu("", {
      mediaType: "video",
      srcURL: "https://example.com/cat.mp4",
    });

    expect(labels).toEqual(
      expect.arrayContaining([
        "Open Video in New Tab",
        "Save Video As…",
        "Copy Video Address",
      ]),
    );
    expect(labels).not.toContain("Copy Image");
  });
});
