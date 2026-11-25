import { type WindowTab } from "@/client/atoms/window";
import { renderWithProviders } from "@/tests/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { groupNameOf, leadTabOf, useGroupLeadUpkeep } from "./group-leads";
import { type GroupOwn, groupLayoutOf } from "./tab-model";
import { chatHref, newChatHref } from "./window-href";
import { ChatIdSchema } from "@instrument-org/workspace/client";

const tab = (id: string, group: string): WindowTab => ({
  group,
  href: `/files?path=${id}`,
  id,
  kind: "screen",
});

const TABS = [tab("a1", "a"), tab("a2", "a"), tab("b1", "b")];

/** The tab up in each group, and what each group keeps of its own. */
const kept = vi.hoisted(
  (): {
    own: Record<string, GroupOwn>;
    up: Record<string, string>;
  } => ({ own: {}, up: {} }),
);

vi.mock("@/client/components/window/window-tabs", () => ({
  useWindowTabs: () => ({
    groupOwn: kept.own,
    layoutOf: (group: string) =>
      groupLayoutOf({ activeByGroup: kept.up, tabs: TABS }, group),
    setGroupOwn: (group: string, change: GroupOwn) => {
      kept.own = {
        ...kept.own,
        [group]: { ...kept.own[group], ...change },
      };
    },
  }),
}));

function Upkeep({ groupUp, listed }: { groupUp: string; listed: string[] }) {
  useGroupLeadUpkeep(groupUp, listed);
  return null;
}

const CHAT = ChatIdSchema.parse("2026-11-14-roofer-quotes");
const CHAT_TAB: WindowTab = {
  group: "a",
  href: chatHref(CHAT),
  id: "chat",
  kind: "screen",
};
const PAGE: WindowTab = {
  group: "a",
  id: "page",
  kind: "page",
  openedAt: 1,
  title: "Roofers near me",
  url: "https://example.com/roofers",
};
const NEW_TAB: WindowTab = {
  group: "a",
  href: newChatHref("01M7BVSPAMVP4SR3P07E7PFGCQ"),
  id: "new",
  kind: "screen",
};

describe("the tab a group goes by", () => {
  beforeEach(() => {
    kept.own = {};
  });

  it("is held while the group is up, and taken again as it is left", () => {
    kept.up = { a: "a1", b: "b1" };
    const { rerender } = renderWithProviders(
      <Upkeep groupUp="a" listed={["a", "b"]} />,
    );
    const held = () =>
      Object.entries(kept.own).map(
        ([group, own]) => `${group}: ${own.lead ?? ""}`,
      );
    const said = [held()];

    // Another tab picked in the group that is up.
    kept.up = { a: "a2", b: "b1" };
    rerender(<Upkeep groupUp="a" listed={["a", "b"]} />);
    said.push(held());

    rerender(<Upkeep groupUp="b" listed={["a", "b"]} />);
    said.push(held());

    expect(said).toMatchInlineSnapshot(`
      [
        [
          "a: a1",
          "b: b1",
        ],
        [
          "a: a1",
          "b: b1",
        ],
        [
          "a: a2",
          "b: b1",
        ],
      ]
    `);
  });

  it("is the group's chat wherever it sits", () => {
    const [left] = TABS;
    expect(
      left &&
        leadTabOf(
          [
            { tabs: [left], up: left },
            { tabs: [CHAT_TAB], up: CHAT_TAB },
          ],
          left.id,
        ),
    ).toBe(CHAT_TAB);
  });
});

describe("a group's name", () => {
  it.each<[string, WindowTab[], string, string | undefined, string]>([
    [
      "its chat's, behind another tab",
      [PAGE, CHAT_TAB],
      "page",
      undefined,
      "Roofer quotes",
    ],
    ["the tab held for it", [PAGE, NEW_TAB], "new", "page", "Roofers near me"],
    [
      "the tab up, with none held",
      [PAGE, NEW_TAB],
      "page",
      undefined,
      "Roofers near me",
    ],
    [
      "a new tab's, whatever is typed in it",
      [NEW_TAB],
      "new",
      undefined,
      "New Tab",
    ],
  ])("is %s", (_case, tabs, up, held, name) => {
    expect(
      groupNameOf(
        groupLayoutOf({ activeByGroup: { a: up }, tabs }, "a"),
        held,
        {
          appsBySlug: new Map(),
          chatTitles: new Map([[CHAT, "**Roofer** quotes"]]),
        },
      ),
    ).toBe(name);
  });
});
