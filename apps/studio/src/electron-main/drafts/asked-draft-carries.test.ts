import { type Draft } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { askedDraftCarries } from "./asked-draft-carries";

const CHAT = "2026-10-26-weather-in-nashville" as ChatId;

let root: string;
let outside: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "asked-draft-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "asked-draft-outside-"));
  fs.writeFileSync(path.join(root, "plan.md"), "# Plan");
  fs.writeFileSync(path.join(outside, "keys.txt"), "secret");
  fs.mkdirSync(path.join(root, ".instrument/chats"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, "linked"));
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
  fs.rmSync(outside, { force: true, recursive: true });
});

const carriesOf = (fields: Partial<Draft>) =>
  askedDraftCarries(
    {
      createdAt: 0,
      id: "01KFDRAFT0000000000000001",
      updatedAt: 0,
      words: "Look at these",
      ...fields,
    },
    {
      chatTitle: (id) =>
        Promise.resolve(id === CHAT ? "Weather in Nashville" : undefined),
      folders: () => Promise.resolve({ root: { path: root } }),
      rootDir: root,
    },
  );

const ask = (file: string) => ({
  createdAt: 0,
  excerpt: "# Plan",
  id: "a",
  instruction: " Rename it ",
  path: file,
  target: "line 1",
});

describe("askedDraftCarries", () => {
  it("carries nothing more for words and what is in the folder", async () => {
    const inFolder = [
      {
        kind: "folder" as const,
        path: path.join(root, ".instrument/drafts/a"),
      },
    ];
    expect(await carriesOf({ attached: inFolder, inFolder })).toEqual({});
  });

  it("carries asks, workspace files, pages, apps and chats, with no chip that grants", async () => {
    const plan = path.join(root, "plan.md");
    const carried = await carriesOf({
      asks: [ask(plan)],
      context: [
        { kind: "file", path: plan },
        { kind: "link", url: "https://shop.example/checkout" },
        { kind: "link", url: "instrument://app/notion" },
        { chat: CHAT, kind: "chat" },
      ],
    });
    expect(carried).toEqual({
      asks: {
        asks: [
          {
            excerpt: "# Plan",
            file: { mount: plan, name: "plan.md", path: plan },
            instruction: "Rename it",
            target: "line 1",
          },
        ],
      },
      viewing: {
        attached: [
          {
            kind: "page",
            title: "https://shop.example/checkout",
            url: "https://shop.example/checkout",
          },
          {
            kind: "screen",
            title: "instrument://app/notion",
            url: "instrument://app/notion",
          },
          { id: CHAT, kind: "chat", title: "Weather in Nashville" },
        ],
        chosen: [{ kind: "file", mount: plan, name: "plan.md", path: plan }],
        links: [
          { url: "https://shop.example/checkout" },
          { url: "instrument://app/notion" },
          { title: "Weather in Nashville", url: `instrument://chat/${CHAT}` },
        ],
        screen: "home",
      },
    });
  });

  it.each([
    ["elsewhere on this computer", () => path.join(outside, "keys.txt")],
    [
      "through a link out of the workspace",
      () => path.join(root, "linked/keys.txt"),
    ],
    ["in the app's own folder", () => path.join(root, ".instrument/chats")],
    ["not on this computer", () => path.join(root, "gone.md")],
  ])("carries nothing of a draft naming a file %s", async (_name, file) => {
    const target = file();
    expect(
      await carriesOf({ context: [{ kind: "file", path: target }] }),
    ).toBeUndefined();
    expect(
      await carriesOf({ attached: [{ kind: "folder", path: target }] }),
    ).toBeUndefined();
    expect(await carriesOf({ asks: [ask(target)] })).toBeUndefined();
  });

  it("carries nothing of a draft naming a chat that is gone, or a file by its address", async () => {
    expect(
      await carriesOf({
        context: [{ chat: "2026-10-02-porto" as ChatId, kind: "chat" }],
      }),
    ).toBeUndefined();
    expect(
      await carriesOf({
        context: [{ kind: "link", url: "file:///etc/hosts" }],
      }),
    ).toBeUndefined();
  });
});
