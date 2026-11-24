import { type Draft, type DraftOp } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createNewTabDrafts, LOST_DRAFT_KEPT_MS } from "./new-tab-drafts";

vi.mock("../lib/electron-logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const START = Date.parse("2026-10-19T12:00:00.000Z");
const ID = "01K7ABCDEFGHJKMNPQRSTVWXYZ";
let dir: string;
let at: number;

const keep = (name: string, text: string) => {
  fs.writeFileSync(path.join(dir, name), text);
};
const tabs = (named: boolean) => {
  keep(
    "windows/app.json",
    JSON.stringify({ closed: named ? `/chats?draft=${ID}` : "" }),
  );
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "new-tab-drafts-"));
  fs.mkdirSync(path.join(dir, "windows"));
  keep("groups.json", "{}");
  tabs(false);
  at = START;
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

const launch = () => createNewTabDrafts({ now: () => at, windowDir: dir });
const draft = (more: Partial<Draft> = {}): Draft => ({
  createdAt: START,
  id: ID,
  updatedAt: START,
  words: "asdf",
  ...more,
});
const start = (more: Partial<Draft> = {}, ...ops: DraftOp[]) => {
  const made = draft(more);
  launch().applied(
    { client: "w", ops: [{ draft: made, type: "create" }, ...ops], seq: 1 },
    [made],
  );
  return made;
};
/** What a launch throws away once an earlier one has found the same a day before. */
const lostAfterADay = (drafts: Draft[]) => {
  const first = launch().lost(drafts);
  at += LOST_DRAFT_KEPT_MS;
  return [...first, ...launch().lost(drafts)];
};

it("throws away words left by a closed tab, a day after a launch finds nothing names them", () => {
  const made = start();
  expect(launch().lost([made])).toEqual([]);
  at += LOST_DRAFT_KEPT_MS - 1;
  expect(launch().lost([made])).toEqual([]);
  at += 1;
  expect(launch().lost([made])).toEqual([ID]);
});

it("keeps a draft any tab names, and starts the day over once none does", () => {
  const made = start();
  launch().lost([made]);
  tabs(true);
  expect(lostAfterADay([made])).toEqual([]);
  tabs(false);
  expect(launch().lost([made])).toEqual([]);
});

it.each<[string, Partial<Draft>]>([
  ["a reply", { chatId: "2026-10-19-hi-abcd" as ChatId }],
  ["one asked to be sent", { sendOn: "dev_TEST" }],
  ["one being sent", { sendingTo: "2026-10-19-hi-abcd" as ChatId }],
  ["one with a project", { projectId: "home" }],
  ["one naming a page", { context: [{ kind: "link", url: "https://a.b" }] }],
  ["one with a folder", { inFolder: [{ kind: "folder", path: "/a" }] }],
  [
    "one with an ask",
    {
      asks: [
        {
          createdAt: 1,
          id: "q",
          instruction: "",
          path: "/a",
          target: "whole file",
        },
      ],
    },
  ],
])("keeps %s", (_what, more) => {
  expect(lostAfterADay([start(more)])).toEqual([]);
});

it("keeps a draft it did not see started, or one changed elsewhere", () => {
  expect(lostAfterADay([draft()])).toEqual([]);
  start();
  expect(lostAfterADay([draft({ updatedAt: START + 5000 })])).toEqual([]);
});

it("compares times to the second, as the file keeps them", () => {
  start({ updatedAt: START + 400 });
  expect(lostAfterADay([draft()])).toEqual([ID]);
});

it("keeps one opened from Drafts, or named in what the person cleared", () => {
  expect(lostAfterADay([start({}, { id: ID, type: "keep" })])).toEqual([]);
  const made = start();
  launch().keepNamedIn([{ pathname: `/chats?draft=${ID}` }]);
  expect(lostAfterADay([made])).toEqual([]);
});

it.each<[string, () => void]>([
  ["missing", () => fs.rmSync(path.join(dir, "groups.json"))],
  ["without a window", () => fs.rmSync(path.join(dir, "windows/app.json"))],
  ["not JSON", () => keep("windows/app.json", "{")],
  ["set aside", () => keep(`groups.json.corrupt-${START + 1}`, "{")],
])("keeps every draft while the tabs are %s", (_what, breakTabs) => {
  const made = start();
  breakTabs();
  expect(lostAfterADay([made])).toEqual([]);
});
