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

// Electron's event payloads are far wider than the handful of fields the menu
// reads, so the doubles carry those fields and are shaped on the way in.
function buildMenu(linkURL: string) {
  const handlers = new Map<string, (event: unknown, params: unknown) => void>();
  const loadURL = vi.fn(() => Promise.resolve());
  const openInNewTab = vi.fn();
  const step = vi.fn();
  const goBack = vi.fn();
  const guest = {
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
  } as unknown as WebContents;

  attachGuestInteractions(guest, { mayOpen: () => true, openInNewTab, step });
  handlers.get("context-menu")?.(null, {
    editFlags: { canCopy: true, canCut: false, canPaste: false },
    isEditable: false,
    linkURL,
    selectionText: "",
    x: 10,
    y: 20,
  });

  const items = buildFromTemplate.mock.lastCall?.[0] ?? [];
  return {
    back: items.find((item) => item.label === "Back"),
    goBack,
    labels: items.flatMap((item) => (item.label ? [item.label] : [])),
    loadURL,
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
});
