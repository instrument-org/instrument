import { COMPUTER_ROOT, fileHref, folderHref } from "@/shared/computer-href";
import { describe, expect, it } from "vitest";

import { tabTooltip } from "./app-tab-strip";
import { RECENTS_ROOT } from "./computer-page";

describe("tabTooltip", () => {
  it.each([
    {
      expected: {
        detail: "sam › visual-answers",
        title: "2026-10-26-billing-controls.html",
      },
      href: fileHref(
        "/Users/sam/visual-answers/2026-10-26-billing-controls.html",
      ),
      name: "a file names the folder it is in",
      url: undefined,
    },
    {
      expected: { detail: "sam", title: "visual-answers" },
      href: folderHref("/Users/sam/visual-answers"),
      name: "a folder names the folder it is in",
      url: undefined,
    },
    {
      expected: {
        detail: "zendesk.com/pricing",
        title: "Suite plans · Zendesk",
      },
      href: "/sites/a",
      name: "a page names its address",
      url: "https://zendesk.com/pricing",
    },
    {
      expected: undefined,
      href: folderHref(RECENTS_ROOT),
      name: "Recents names nothing",
      url: undefined,
    },
    {
      expected: undefined,
      href: folderHref(COMPUTER_ROOT),
      name: "the computer names nothing",
      url: undefined,
    },
    {
      expected: undefined,
      href: folderHref("/"),
      name: "the top of a disk names nothing",
      url: undefined,
    },
    {
      expected: undefined,
      href: "/apps",
      name: "a place with nothing more to say names nothing",
      url: undefined,
    },
  ])("$name", ({ expected, href, url }) => {
    const title = expected?.title ?? "Tab";
    expect(tabTooltip(href, { title, url })).toEqual(expected);
  });
});
