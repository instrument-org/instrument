import { type WindowTab } from "@/client/atoms/window";
import { renderWithProviders } from "@/tests/render";
import { useAtomValue } from "jotai";
import { describe, expect, it, vi } from "vitest";

import { groupLeadsAtom, leadTabOf, useGroupLeadUpkeep } from "./group-leads";
import { groupLayoutOf } from "./tab-model";
import { chatHref } from "./window-href";
import { ChatIdSchema } from "@instrument-org/workspace/client";

const tab = (id: string, group: string): WindowTab => ({
  group,
  href: `/files?path=${id}`,
  id,
  kind: "screen",
});

const TABS = [tab("a1", "a"), tab("a2", "a"), tab("b1", "b")];

/** The tab up in each group. */
const up = vi.hoisted((): { byGroup: Record<string, string> } => ({
  byGroup: {},
}));

vi.mock("@/client/components/window/window-tabs", () => ({
  useWindowTabs: () => ({
    layoutOf: (group: string) =>
      groupLayoutOf({ activeByGroup: up.byGroup, tabs: TABS }, group),
  }),
}));

function Leads({ groupUp, listed }: { groupUp: string; listed: string[] }) {
  useGroupLeadUpkeep(groupUp, listed);
  const leads = useAtomValue(groupLeadsAtom);
  return <output>{JSON.stringify(Object.fromEntries(leads))}</output>;
}

describe("the tab a group goes by", () => {
  it("is held while the group is up, taken again as it is left, and let go with the group", () => {
    up.byGroup = { a: "a1", b: "b1" };
    const { container, rerender } = renderWithProviders(
      <Leads groupUp="a" listed={["a", "b"]} />,
    );
    const said = [container.textContent];

    // Another tab picked in the group that is up.
    up.byGroup = { a: "a2", b: "b1" };
    rerender(<Leads groupUp="a" listed={["a", "b"]} />);
    said.push(container.textContent);

    rerender(<Leads groupUp="b" listed={["a", "b"]} />);
    said.push(container.textContent);

    rerender(<Leads groupUp="b" listed={["b"]} />);
    said.push(container.textContent);

    expect(said).toMatchInlineSnapshot(`
      [
        "{"a":"a1","b":"b1"}",
        "{"a":"a1","b":"b1"}",
        "{"a":"a2","b":"b1"}",
        "{"b":"b1"}",
      ]
    `);
  });

  it("is the group's chat wherever it sits", () => {
    const chat: WindowTab = {
      group: "a",
      href: chatHref(ChatIdSchema.parse("2026-11-14-roofer-quotes")),
      id: "chat",
      kind: "screen",
    };
    const [left] = TABS;
    expect(
      left &&
        leadTabOf(
          [
            { tabs: [left], up: left },
            { tabs: [chat], up: chat },
          ],
          left.id,
        ),
    ).toBe(chat);
  });
});
