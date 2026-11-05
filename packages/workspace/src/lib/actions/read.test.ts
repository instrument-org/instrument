import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  forgetRecordedActions,
  recordActions,
} from "../../test/helpers/recorded-actions";
import { getWorkspaceConfig } from "../workspace-config";
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

afterEach(async () => {
  await forgetRecordedActions();
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
