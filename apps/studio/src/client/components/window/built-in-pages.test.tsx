import { describe, expect, it, vi } from "vitest";

import { bringForwardShowing } from "./built-in-pages";
import { showsSame } from "./window-href";

type Handle = Parameters<typeof bringForwardShowing>[0];

/** The group up's tabs, as the opener reads them: each a screen at an address. */
function groupUp(...hrefs: string[]) {
  const tabs = hrefs.map((href, index) => ({
    href,
    id: `tab-${index}`,
    kind: "screen" as const,
  }));
  const select = vi.fn();
  const visitHref = vi.fn();
  const handle = {
    active: tabs[0],
    selectShowing: (href: string) => {
      const found = tabs.find((tab) => showsSame(tab.href, href));
      if (found) {
        select(found.id);
      }
      return found !== undefined;
    },
    tabs,
    visitHref,
  };
  // Only what the opener reads of the window's tabs.
  return { handle: handle as unknown as Handle, select, visitHref };
}

// A built-in page asked for by a command or a chord (Settings from Cmd+,,
// History, What's new) brings forward the group's tab already showing
// it, walked to the part asked for; with none, the caller opens it as a
// tab group of its own (`setBuiltInPageGroupOpener`).
describe("a built-in page asked for by a command", () => {
  it("is for a group of its own where no tab of the group shows it", () => {
    const { handle, select } = groupUp("/chats/2026-10-01-roofer");
    expect(bringForwardShowing(handle, "/settings/general")).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it("brings Settings forward at the part asked for", () => {
    const { handle, select, visitHref } = groupUp(
      "/chats/2026-10-01-roofer",
      "/settings/general",
    );
    expect(bringForwardShowing(handle, "/settings/providers")).toBe(true);
    expect(select).toHaveBeenCalledWith("tab-1");
    expect(visitHref).toHaveBeenCalledWith("tab-1", "/settings/providers");
  });

  it.each(["/settings", "/settings/general"])(
    "brings Settings forward where it stands for %s",
    (href) => {
      const { handle, select, visitHref } = groupUp(
        "/release-notes",
        "/settings/general",
      );
      expect(bringForwardShowing(handle, href)).toBe(true);
      expect(select).toHaveBeenCalledWith("tab-1");
      expect(visitHref).not.toHaveBeenCalled();
    },
  );

  it("brings the debug pages forward where they stand for the landing page", () => {
    const { handle, select, visitHref } = groupUp(
      "/chats/2026-10-01-roofer",
      "/debug/billing",
    );
    expect(bringForwardShowing(handle, "/debug")).toBe(true);
    expect(select).toHaveBeenCalledWith("tab-1");
    expect(visitHref).not.toHaveBeenCalled();
  });

  it("brings the debug pages forward at the page asked for", () => {
    const { handle, select, visitHref } = groupUp(
      "/chats/2026-10-01-roofer",
      "/debug/billing",
    );
    expect(bringForwardShowing(handle, "/debug/components/colors")).toBe(true);
    expect(select).toHaveBeenCalledWith("tab-1");
    expect(visitHref).toHaveBeenCalledWith("tab-1", "/debug/components/colors");
  });

  it("brings another built-in page forward as it stands", () => {
    const { handle, select, visitHref } = groupUp(
      "/settings/general",
      "/release-notes",
    );
    expect(bringForwardShowing(handle, "/release-notes")).toBe(true);
    expect(select).toHaveBeenCalledWith("tab-1");
    expect(visitHref).not.toHaveBeenCalled();
  });
});
