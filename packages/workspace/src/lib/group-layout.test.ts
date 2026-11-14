import { describe, expect, it } from "vitest";

import {
  type LayoutChange,
  type LayoutSnapshot,
  type LayoutTab,
} from "../schemas/group-layout";
import {
  type LayoutElsewhere,
  layoutChanges,
  layoutChangesLine,
} from "./group-layout";

/**
 * A layout from one line: sides split by `|`, tabs by spaces, `*` on the tab
 * up, `@` for the chat itself. A tab is a website named by its id, at the
 * page named after `:` when it has gone somewhere else (`A:b`).
 */
function layout(line: string, group = "g1"): LayoutSnapshot {
  const sides = line.split("|").map((side) => ({
    tabs: side
      .trim()
      .split(/\s+/)
      .map((token): LayoutTab => {
        const isUp = token.endsWith("*");
        const [id = "", page = id.toLowerCase()] = token
          .replace("*", "")
          .split(":");
        const up = isUp ? { isUp: true } : {};
        return id === "@"
          ? {
              address: "instrument://chat/chat_1",
              id: "chat",
              isThisChat: true,
              kind: "chat",
              title: "Help desk prices",
              ...up,
            }
          : {
              address: `https://${page}.example/`,
              id,
              kind: "website",
              title: page.toUpperCase(),
              ...up,
            };
      }),
  }));
  return {
    focused: 0,
    group: { id: group, title: group === "g1" ? "Prices" : "Other" },
    sides,
  };
}

/** A change in a few words, for reading a list of them at a glance. */
function brief(change: LayoutChange): string {
  switch (change.change) {
    case "chatMoved": {
      return `chat moved from ${change.from} to ${change.to}`;
    }
    case "closed": {
      return `closed ${change.tab.id}`;
    }
    case "moved": {
      const who = change.tab.isThisChat ? "@" : change.tab.id;
      return `moved ${who} ${change.from ?? "whole"} -> ${change.to ?? "whole"}${change.from === change.to ? ` after ${change.after ?? "nothing"}` : ""}${change.beside ? " beside" : ""}`;
    }
    case "movedIn": {
      return `moved in ${change.tab.id} from ${change.from} to ${change.side ?? "whole"}${change.beside ? " beside" : ""}`;
    }
    case "movedOut": {
      return `moved out ${change.tab.id} to ${change.to}`;
    }
    case "navigated": {
      return `navigated ${change.tab.id} ${change.from.address} -> ${change.tab.address}`;
    }
    case "opened": {
      return `opened ${change.tab.id} ${change.side ?? "whole"}${change.beside ? " beside" : ""}`;
    }
  }
}

describe("layoutChanges", () => {
  it.each<[string, string, string, string[], LayoutElsewhere?]>([
    ["nothing changed", "A* | @*", "A* | @*", []],
    ["only the tab up changed", "A* B | @*", "A B* | @*", []],
    ["a tab opened beside the chat", "@*", "A* | @*", ["opened A left beside"]],
    [
      "a tab opened in front of others",
      "A* | @*",
      "N A* | @*",
      ["opened N left beside"],
    ],
    [
      "a tab opened on the chat's side",
      "A* | @*",
      "A* | @* N",
      ["opened N right"],
    ],
    ["a tab closed", "A* B | @*", "A* | @*", ["closed B"]],
    ["the last tab beside closed", "A* | @*", "@*", ["closed A"]],
    [
      "a tab dragged to the front",
      "A* B C | @*",
      "C* A B | @*",
      ["moved C left -> left after nothing beside"],
    ],
    [
      "a tab dragged one along",
      "A* B C | @*",
      "B* A C | @*",
      ["moved B left -> left after nothing beside"],
    ],
    [
      "a tab moved to the chat's side",
      "A* B | @*",
      "A* | @* B",
      ["moved B left -> right"],
    ],
    [
      "the sides swapped",
      "A* | @*",
      "@* | A*",
      ["moved @ right -> left", "moved A left -> right beside"],
    ],
    [
      "the chat split off to the right",
      "A* @",
      "A* | @*",
      ["moved @ whole -> right"],
    ],
    [
      "a tab split off to the right",
      "@* A",
      "@* | A*",
      ["moved A whole -> right beside"],
    ],
    ["two sides became one", "A* | @*", "A @*", ["moved @ right -> whole"]],
    [
      "a tab went to another page",
      "A* | @*",
      "A:b* | @*",
      ["navigated A https://a.example/ -> https://b.example/"],
    ],
    [
      "a tab moved out to another group",
      "A* B | @*",
      "A* | @*",
      ["moved out B to Launch post"],
      { after: { B: "Launch post" } },
    ],
    [
      "a tab moved in from another group",
      "A* | @*",
      "A* B | @*",
      ["moved in B from Launch post to left beside"],
      { before: { B: "Launch post" } },
    ],
    [
      "a tab that left a group and came back",
      "A* | @*",
      "A* | @*",
      [],
      { after: { A: "Launch post" } },
    ],
    [
      "several at once",
      "A* B C | @*",
      "C:d* A | @* N",
      [
        "closed B",
        "moved C left -> left after nothing beside",
        "navigated C https://c.example/ -> https://d.example/",
        "opened N right",
      ],
    ],
  ])("%s", (_case, before, after, expected, elsewhere) => {
    expect(
      layoutChanges(layout(before), layout(after), elsewhere).map(brief),
    ).toEqual(expected);
  });

  it("says only that the chat moved when it is in another group", () => {
    expect(layoutChanges(layout("A* | @*"), layout("B* @", "g2")))
      .toMatchInlineSnapshot(`
      [
        {
          "change": "chatMoved",
          "from": "Prices",
          "to": "Other",
        },
      ]
    `);
  });

  it("takes a draft's tab and its chat's as the same tab", () => {
    const draft = layout("A* | @*");
    const started = layout("A* | @*");
    const [, [chat] = []] = started.sides.map((side) => side.tabs);
    if (chat) {
      chat.id = "a-chat-id";
    }
    expect(layoutChanges(draft, started)).toEqual([]);
  });

  it("names a tab as it stands after, with where it went", () => {
    expect(layoutChanges(layout("@*"), layout("A* | @*")))
      .toMatchInlineSnapshot(`
      [
        {
          "beside": true,
          "change": "opened",
          "side": "left",
          "tab": {
            "address": "https://a.example/",
            "id": "A",
            "kind": "website",
            "title": "A",
          },
        },
      ]
    `);
  });
});

describe("layoutChangesLine", () => {
  it.each([
    [
      "a tab opened beside the chat",
      "@*",
      "A* | @*",
      "Opened A beside this chat",
    ],
    [
      "two opened, one closed",
      "A* | @*",
      "B C* | @*",
      "Opened B and C beside this chat, closed A",
    ],
    ["three opened", "@*", "A B C* | @*", "Opened 3 tabs beside this chat"],
    ["one on the chat's side", "A* | @*", "A* | @* N", "Opened N"],
    [
      "the sides swapped",
      "A* | @*",
      "@* | A*",
      "Moved this chat to the left, moved A beside this chat",
    ],
    ["the chat split off", "A* @", "A* | @*", "Moved this chat to the right"],
    [
      "two sides became one",
      "A* | @*",
      "A @*",
      "Moved this chat into one side",
    ],
    ["a tab dragged along", "A* B | @*", "B* A | @*", "Moved B"],
    ["a tab went elsewhere", "A* | @*", "A:b* | @*", "Went to B"],
    ["nothing", "A* | @*", "A* | @*", ""],
  ])("%s", (_case, before, after, line) => {
    expect(
      layoutChangesLine(layoutChanges(layout(before), layout(after))),
    ).toBe(line);
  });
});
