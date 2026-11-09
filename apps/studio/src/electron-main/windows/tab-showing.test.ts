import { fileHref } from "@/shared/computer-href";
import { type TabsModel, TabIdSchema } from "@/shared/tabs";
import { describe, expect, it } from "vitest";

import { otherStripShowing, stripShowing } from "./tab-showing";

const HOME = "/Users/mac-user";
const NOTES = `${HOME}/notes.md`;
/** A file's tab as it stands once the route has settled its layout. */
const SETTLED = `/files?file=${encodeURIComponent(NOTES)}&path=&root=~&view=columns`;

function strip(pathnames: string[], up = 0): TabsModel {
  const tabs = pathnames.map((pathname, at) => ({
    id: TabIdSchema.parse(`t${at.toString()}`),
    pathname,
  }));
  return { recentlyClosed: [], selectedId: tabs[up]?.id ?? null, tabs };
}

describe("stripShowing", () => {
  it.each([
    ["a file whose tab settled its layout", fileHref(NOTES), SETTLED],
    [
      "a folder walked to from home",
      "/files?path=&root=%2FUsers%2Fmac-user%2FDocuments",
      "/files?path=Documents%2F&root=~&view=list",
    ],
    ["a chat at its address", "/chats/c1", "/chats/c1?inbox=1"],
  ])("finds %s", (_, href, kept) => {
    expect(
      stripShowing(
        href,
        [
          { model: strip(["/apps"]), window: "a" },
          { model: strip(["/new-tab", kept]), window: "b" },
        ],
        HOME,
      ),
    ).toBe("b");
  });

  it("takes the window with the tab up over one with it behind", () => {
    expect(
      stripShowing(
        fileHref(NOTES),
        [
          { model: strip(["/apps", SETTLED]), window: "behind" },
          { model: strip([SETTLED]), window: "up" },
        ],
        HOME,
      ),
    ).toBe("up");
  });

  it("finds no window for a page nothing shows", () => {
    expect(
      stripShowing(
        "/browser",
        [{ model: strip(["/apps"]), window: "a" }],
        HOME,
      ),
    ).toBeNull();
  });
});

describe("otherStripShowing", () => {
  it("leaves out the window asking, which already looked at its own", () => {
    const strips = [
      { model: strip([SETTLED]), webContentsId: 1, window: "asking" },
      { model: strip(["/apps", SETTLED]), webContentsId: 2, window: "other" },
    ];
    expect(otherStripShowing(fileHref(NOTES), strips, 1, HOME)).toBe("other");
    expect(
      otherStripShowing(fileHref(NOTES), strips.slice(0, 1), 1, HOME),
    ).toBeNull();
  });
});
