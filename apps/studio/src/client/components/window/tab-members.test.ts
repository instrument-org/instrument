import { describe, expect, it } from "vitest";

import { joinTabGroups, splitTabGroups } from "./tab-members";

const member = (own: Record<string, unknown>) =>
  new Map<string, unknown>([
    [
      "group_a",
      {
        focused: 0,
        sides: [{ tabs: [{ href: "/files", id: "a", kind: "screen" }] }],
        ...own,
      },
    ],
  ]);

describe("a tab group's name as it is kept", () => {
  it("comes back as it was written", () => {
    const joined = joinTabGroups(member({ name: "Side panel" }));
    expect(joined.groups).toEqual({ group_a: { name: "Side panel" } });
    expect(splitTabGroups(joined).get("group_a")).toMatchObject({
      name: "Side panel",
    });
  });

  it("reads a name an earlier build kept from a link, and writes it as a name", () => {
    const joined = joinTabGroups(member({ linkGroup: "Side panel" }));
    expect(joined.groups).toEqual({ group_a: { name: "Side panel" } });
    expect(splitTabGroups(joined).get("group_a")).not.toHaveProperty(
      "linkGroup",
    );
  });
});

describe("a tab's agent id as it is kept", () => {
  it("comes back as it was written, through the kept file's JSON", () => {
    const tabs = {
      activeByGroup: { group_a: "file" },
      tabs: [
        {
          agentId: "page",
          group: "group_a",
          href: "/files?file=%2Freport.html",
          id: "file",
          kind: "screen" as const,
        },
      ],
    };
    const written = JSON.parse(
      JSON.stringify(Object.fromEntries(splitTabGroups(tabs))),
    ) as Record<string, unknown>;
    expect(joinTabGroups(new Map(Object.entries(written))).tabs).toMatchObject([
      { agentId: "page", group: "group_a", id: "file" },
    ]);
  });
});
