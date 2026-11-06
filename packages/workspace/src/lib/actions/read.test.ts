import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import {
  forgetRecordedActions,
  recordActions,
} from "../../test/helpers/recorded-actions";
import { ChatWrites } from "../chat-writes";
import { updatePermissionSettings } from "../permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { actionLog, actionsDir } from "./log";
import { readActions, readActionsNewestFirst } from "./read";

const MIN = 60_000;
const NOW = new Date(2026, 10, 5, 14, 30).getTime();

/** What each action names, in the order read. */
const named = (actions: { at: string; kind: string }[]) =>
  actions.map((each) =>
    "path" in each
      ? `${each.kind} ${String(each.path)}`
      : "url" in each
        ? `${each.kind} ${String(each.url)}`
        : each.kind,
  );

afterEach(() => {
  forgetRecordedActions();
});

describe("readActions", () => {
  it("puts the log and the history's pages and files in one list, oldest first", async () => {
    recordActions([
      [NOW - 9 * MIN, { kind: "folder", path: "/Users/mac-user/Taxes" }],
      [NOW - 8 * MIN, { kind: "file", path: "/Users/mac-user/Taxes/w2.pdf" }],
      [NOW - 7 * MIN, { kind: "edit", path: "/Users/mac-user/notes.md" }],
      [NOW - 6 * MIN, { kind: "page", url: "https://irs.gov/" }],
      [
        NOW - 5 * MIN,
        { app: "Preview", kind: "open-with", path: "/Users/mac-user/a.pdf" },
      ],
    ]);

    expect(
      named(await readActions({ since: NOW - 10 * MIN, until: NOW })),
    ).toEqual([
      "folder /Users/mac-user/Taxes",
      "file /Users/mac-user/Taxes/w2.pdf",
      "edit /Users/mac-user/notes.md",
      "page https://irs.gov/",
      "open-with /Users/mac-user/a.pdf",
    ]);
  });

  it("keeps one opening of a page or file opened again within a minute, the latest", async () => {
    const a = "/Users/mac-user/wireframes/a.html";
    const b = "/Users/mac-user/wireframes/b.html";
    const SEC = 1000;
    recordActions([
      [NOW - 5 * MIN, { kind: "file", path: a }],
      [NOW - 5 * MIN + 10 * SEC, { kind: "file", path: b }],
      [NOW - 5 * MIN + 20 * SEC, { kind: "file", path: a }],
      [NOW - 5 * MIN + 30 * SEC, { kind: "file", path: b }],
      [NOW - 5 * MIN + 40 * SEC, { kind: "file", path: a }],
      [NOW - 3 * MIN, { kind: "file", path: a }],
      [NOW - 2 * MIN, { kind: "page", url: "https://irs.gov/" }],
      [NOW - 2 * MIN + 5 * SEC, { kind: "page", url: "https://irs.gov/" }],
      [NOW - MIN, { app: "Preview", kind: "open-with", path: a }],
    ]);

    expect(
      named(await readActions({ since: NOW - 10 * MIN, until: NOW })),
    ).toMatchInlineSnapshot(`
      [
        "file /Users/mac-user/wireframes/b.html",
        "file /Users/mac-user/wireframes/a.html",
        "file /Users/mac-user/wireframes/a.html",
        "page https://irs.gov/",
        "open-with /Users/mac-user/wireframes/a.html",
      ]
    `);

    const page = await readActionsNewestFirst({
      limit: 3,
      since: NOW - 10 * MIN,
      skip: 0,
      until: NOW,
    });
    expect({
      more: page.more,
      named: named(page.actions),
    }).toMatchInlineSnapshot(`
      {
        "more": true,
        "named": [
          "open-with /Users/mac-user/wireframes/a.html",
          "page https://irs.gov/",
          "file /Users/mac-user/wireframes/a.html",
        ],
      }
    `);
  });

  it("reads past a log line of a kind the history keeps now", async () => {
    recordActions([[NOW - 2 * MIN, { kind: "screen", name: "Apps" }]]);
    actionLog().close();
    const file = fs
      .readdirSync(actionsDir(getWorkspaceConfig().workspaceMachineDir))
      .map((name) =>
        path.join(actionsDir(getWorkspaceConfig().workspaceMachineDir), name),
      )[0];
    fs.appendFileSync(
      file ?? "",
      `${JSON.stringify({ at: new Date(NOW - MIN).toISOString(), kind: "page", url: "https://old.example/" })}\n`,
    );

    expect(
      named(await readActions({ since: NOW - 10 * MIN, until: NOW })),
    ).toEqual(["screen"]);
  });
});

describe("the permissions the person answered", () => {
  it("are read from each chat's grants and refusals, naming the chat by its title", async () => {
    const original = getWorkspaceConfig();
    const kitchen = ChatIdSchema.parse("kitchen-remodel-quotes");
    createMockChatConfig(kitchen);
    try {
      await ChatWrites.saveSession(
        {
          createdAt: new Date(0),
          id: StoreId.newSessionId(),
          title: "Kitchen remodel quotes",
        },
        kitchen,
      );
      const at = (minutes: number) => new Date(NOW - minutes * MIN);
      await updatePermissionSettings((settings) => ({
        ...settings,
        chats: {
          [kitchen]: {
            appGrants: [{ app: "Mail", grantedAt: at(4) }],
            denials: [
              { deniedAt: at(3), kind: "folder", target: "/Users/mac-user" },
              { deniedAt: at(2), kind: "app", target: "Music" },
            ],
            grants: [
              {
                grantedAt: at(6),
                path: AbsolutePathSchema.parse("/Users/mac-user/Downloads"),
                source: "card",
              },
              // A file sent with a message is no answer.
              {
                grantedAt: at(5),
                kind: "file",
                path: AbsolutePathSchema.parse("/Users/mac-user/quote.pdf"),
                source: "attached",
              },
            ],
          },
          // A chat with nothing to read a title from is left out.
          "gone-chat": {
            appGrants: [{ app: "Notes", grantedAt: at(1) }],
            denials: [],
            grants: [],
          },
          // Before the range.
          [`${kitchen}-old`]: {
            appGrants: [{ app: "Notes", grantedAt: at(90) }],
            denials: [],
            grants: [],
          },
        },
      }));

      expect(
        (await readActions({ since: NOW - 10 * MIN, until: NOW })).map(
          (action) =>
            action.kind === "permission"
              ? `${action.did} ${action.title}: ${action.path ?? action.app ?? ""}`
              : action.kind,
        ),
      ).toEqual([
        "allowed Kitchen remodel quotes: /Users/mac-user/Downloads",
        "allowed Kitchen remodel quotes: Mail",
        "refused Kitchen remodel quotes: /Users/mac-user",
        "refused Kitchen remodel quotes: Music",
      ]);
    } finally {
      await updatePermissionSettings((settings) => ({
        ...settings,
        chats: {},
      }));
      setWorkspaceConfig(original);
    }
  });
});

describe("readActionsNewestFirst", () => {
  it("pages both sources newest first, each read only as far as the page", async () => {
    recordActions([
      [NOW - 6 * MIN, { kind: "folder", path: "/Users/mac-user/a" }],
      [NOW - 5 * MIN, { kind: "page", url: "https://b.example/" }],
      [NOW - 4 * MIN, { kind: "page", url: "https://c.example/" }],
      [NOW - 3 * MIN, { kind: "folder", path: "/Users/mac-user/d" }],
      [NOW - 2 * MIN, { kind: "file", path: "/Users/mac-user/e.txt" }],
    ]);
    const page = (skip: number) =>
      readActionsNewestFirst({ limit: 2, since: 0, skip, until: NOW });

    const first = await page(0);
    expect(named(first.actions)).toEqual([
      "file /Users/mac-user/e.txt",
      "folder /Users/mac-user/d",
    ]);
    expect(first.more).toBe(true);
    const second = await page(2);
    expect(named(second.actions)).toEqual([
      "page https://c.example/",
      "page https://b.example/",
    ]);
    expect(second.more).toBe(true);
    const third = await page(4);
    expect(named(third.actions)).toEqual(["folder /Users/mac-user/a"]);
    expect(third.more).toBe(false);
  });
});
