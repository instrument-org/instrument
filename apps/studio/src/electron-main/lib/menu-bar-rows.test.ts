import type { Chat } from "@instrument-org/workspace/electron";
import { describe, expect, it } from "vitest";

import { menuBarView } from "./menu-bar-rows";

let next = 0;

/** A chat with only what the menu reads set; the rest is filler a row never shows. */
function chat(
  over: { [K in keyof Chat]?: unknown } & Pick<Chat, "status" | "title">,
): Chat {
  next += 1;
  // A test double: the menu reads none of the fields left at their filler.
  return {
    archived: false,
    createdAt: 0,
    firstAsk: "",
    holds: { apps: [], files: [], sites: [] },
    id: `chat-${next}`,
    lastUserMessageAt: next,
    ownWorking: false,
    runningTasks: [],
    sessionId: `ses_${next}`,
    starred: false,
    titleByApp: false,
    titled: true,
    ...over,
  } as Chat;
}

describe("menuBarView", () => {
  it("shows nothing but the idle icon while no chat waits or works", () => {
    expect(
      menuBarView([chat({ status: "idle", title: "Q3 board update" })]),
    ).toEqual({ icon: "idle", sections: [] });
  });

  it("lists what needs you before what is working, newest first, archived left out", () => {
    const view = menuBarView([
      chat({
        latest: {
          at: 5,
          kind: "question",
          text: "Can Instrument use Downloads?\nMore",
        },
        status: "waiting",
        title: "Renewal reminders",
      }),
      chat({
        ownStep: "Reading plans on zendesk.com",
        status: "working",
        title: "Pricing",
      }),
      chat({
        runningTasks: [
          {
            id: "ses_task",
            step: "Writing q3-board-update.md",
            title: "Board",
          },
        ],
        status: "working",
        title: "Board update",
      }),
      chat({ archived: true, status: "working", title: "Put away" }),
    ]);
    expect(view.icon).toBe("ask");
    expect(
      view.sections.map(({ chats, label, more }) => ({
        label,
        more,
        rows: chats.map((each) => `${each.title}: ${each.line}`),
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "label": "Needs you",
          "more": 0,
          "rows": [
            "Renewal reminders: Can Instrument use Downloads?",
          ],
        },
        {
          "label": "Working",
          "more": 0,
          "rows": [
            "Board update: Writing q3-board-update.md",
            "Pricing: Reading plans on zendesk.com",
          ],
        },
      ]
    `);
  });

  it("caps a section at eight chats and counts the rest", () => {
    const view = menuBarView(
      Array.from({ length: 11 }, (_, i) =>
        chat({ status: "working", title: `Chat ${i}` }),
      ),
    );
    expect(view.icon).toBe("working");
    expect(view.sections[0]?.chats).toHaveLength(8);
    expect(view.sections[0]?.more).toBe(3);
  });
});
