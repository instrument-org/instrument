import {
  NEW_TAB_HREF,
  type ScreenView,
  type WindowTab,
} from "@/client/atoms/window";
import { folderHref } from "@/shared/computer-href";
import { describe, expect, it } from "vitest";

import { bandViewOf } from "./draft-context";

describe("bandViewOf", () => {
  const FOLDER_VIEW: ScreenView = {
    folder: { display: "~/Documents", selected: [] },
    screen: "computer",
  };

  it.each<[string, undefined | WindowTab, unknown]>([
    ["nothing up", undefined, { screen: "home" }],
    [
      "the band's own face",
      { group: "g", href: NEW_TAB_HREF, id: "t", kind: "screen" },
      { screen: "home" },
    ],
    [
      "a page",
      { group: "g", id: "t", kind: "page", openedAt: 1, url: "https://a.b/" },
      { screen: "browser" },
    ],
    [
      "a folder, as its screen said it",
      {
        group: "g",
        href: folderHref("/Users/casey/Documents"),
        id: "t",
        kind: "screen",
      },
      FOLDER_VIEW,
    ],
    [
      "an app, which the tabs name instead",
      { group: "g", href: "/apps/notion", id: "t", kind: "screen" },
      null,
    ],
  ])("says %s", (_name, up, expected) => {
    expect(bandViewOf(up, FOLDER_VIEW)).toEqual(expected);
  });

  it("says nothing for a folder whose screen has not said what it shows", () => {
    expect(
      bandViewOf(
        {
          group: "g",
          href: folderHref("/Users/casey/Documents"),
          id: "t",
          kind: "screen",
        },
        undefined,
      ),
    ).toBeNull();
  });
});
