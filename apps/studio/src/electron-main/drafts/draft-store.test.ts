import { type Draft, type DraftOp, type DraftsSnapshot } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDraftStore } from "./draft-store";

vi.mock("../lib/electron-logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const CHAT = "2026-10-19-what-s-my-latest-tweet" as ChatId;

/**
 * Midday UTC, so the day the folders are named for is the same wherever the
 * machine running the tests is.
 */
const DAY = Date.parse("2026-10-19T12:00:00.000Z");

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "draft-store-"));
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

const draft = (id: string, more: Partial<Draft> = {}): Draft => ({
  createdAt: DAY,
  id,
  updatedAt: DAY,
  words: "",
  ...more,
});

/** A store over the test's folder, with every snapshot it sent. */
function open() {
  const told: DraftsSnapshot[] = [];
  const store = createDraftStore({
    onChange: (snapshot) => told.push(snapshot),
    rootDir: root,
    timeZone: "UTC",
  });
  store.load();
  let seq = 0;
  const apply = (...ops: DraftOp[]) => {
    seq += 1;
    store.apply({ client: "window", ops, seq });
  };
  return { apply, store, told };
}

/** Every file under the workspace, by its path there. */
function tree(): string[] {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)),
    )
    .toSorted();
}

const fileOf = (folder = "2026-10-19") =>
  path.join(root, "Drafts", folder, "DRAFT.md");

const read = (folder?: string) => fs.readFileSync(fileOf(folder), "utf8");

describe("a window's ops", () => {
  it("write a draft once there is something in it, in a folder named for the day it was started", () => {
    const { apply, store, told } = open();

    apply({ draft: draft("a"), type: "create" });
    expect(tree()).toEqual([]);

    apply({
      at: DAY,
      id: "a",
      set: { words: "Plan the trip" },
      type: "update",
    });
    expect(tree()).toEqual(["Drafts/2026-10-19/DRAFT.md"]);
    expect(read()).toMatchInlineSnapshot(`
      "---
      id: "a"
      created: 2026-10-19T12:00:00.000Z
      updated: 2026-10-19T12:00:00.000Z
      ---

      Plan the trip
      "
    `);
    expect(told.at(-1)).toEqual({
      acks: { window: 2 },
      drafts: store.snapshot().drafts,
    });
  });

  it("take a draft away with what was pasted into it", () => {
    const { apply, store } = open();
    apply({ draft: draft("a"), type: "create" });
    const pasted = store.stage({
      content: Buffer.from("png").toString("base64"),
      draftId: "a",
      itemId: "i",
      name: "image.png",
    });
    apply({
      at: DAY,
      id: "a",
      set: {
        attached: [
          {
            kind: "file",
            mimeType: "image/png",
            name: "image.png",
            path: pasted.path,
            size: pasted.size,
          },
        ],
      },
      type: "update",
    });
    expect(read()).toContain('path: "image.png"');

    apply({ id: "a", type: "remove" });

    expect(tree()).toEqual([]);
  });

  it("point a draft being sent at its chat on disk, with the words it is sent with, before they answer", () => {
    const { apply } = open();
    apply({
      draft: draft("a", { words: "what's my latest t" }),
      type: "create",
    });

    apply({
      at: DAY,
      chatId: CHAT,
      id: "a",
      type: "claim",
      words: "what's my latest tweet",
    });

    expect(read()).toContain(`chat: "${CHAT}"`);
    expect(read()).toContain("what's my latest tweet");
  });

  it("take the chat off again when the send fails, so a new chat's draft is not left a reply", () => {
    const { apply, store } = open();
    apply({ draft: draft("a", { words: "hi" }), type: "create" });
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "hi" });

    apply({ id: "a", type: "release" });

    expect(read()).not.toContain("chat:");
    expect(store.snapshot().drafts[0]).toEqual(draft("a", { words: "hi" }));
  });

  it("keep front matter another program left, and state this build does not know", () => {
    fs.mkdirSync(path.dirname(fileOf()), { recursive: true });
    fs.writeFileSync(
      fileOf(),
      [
        "---",
        'id: "a"',
        "created: 2026-10-19T12:00:00.000Z",
        "updated: 2026-10-19T12:00:00.000Z",
        'state: {"pinned":true,"leftOut":"not a list"}',
        "phone: { color: blue }",
        "---",
        "",
        "Plan",
        "",
      ].join("\n"),
    );
    const { apply, store } = open();
    // A key this build knows that holds something it cannot use is left out.
    expect(store.snapshot().drafts[0]).toEqual({
      ...draft("a", { words: "Plan" }),
      pinned: true,
    });

    apply({
      at: DAY,
      id: "a",
      set: { words: "Plan the trip" },
      type: "update",
    });

    expect(read()).toContain('state: {"pinned":true}');
    expect(read()).toContain("phone:");
  });
});

describe("the folder changing under the app", () => {
  it("is not told of the store's own writes", () => {
    const { apply, store, told } = open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    const heard = told.length;

    store.reconcile();

    expect(told).toHaveLength(heard);
  });

  it("takes in a draft edited, added, or deleted there", () => {
    const { apply, store } = open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    fs.writeFileSync(fileOf(), read().replace("Plan", "Plan the trip"));
    fs.mkdirSync(path.join(root, "Drafts", "copied in"));
    fs.writeFileSync(
      path.join(root, "Drafts", "copied in", "DRAFT.md"),
      '---\nid: "b"\ncreated: 2026-10-19T13:00:00.000Z\n---\n\nFrom the phone\n',
    );

    store.reconcile();
    expect(store.snapshot().drafts.map((entry) => entry.words)).toEqual([
      "Plan the trip",
      "From the phone",
    ]);

    fs.rmSync(fileOf());
    store.reconcile();
    expect(store.snapshot().drafts.map((entry) => entry.id)).toEqual(["b"]);
  });

  // What the inbox once showed as Draft on a chat that had just been
  // started: the draft was pointed at its chat behind the store's back, and
  // the change the watcher found for it read as one made elsewhere.
  it("never brings back a draft the window sent", () => {
    const { apply, store } = open();
    apply({
      draft: draft("a", { words: "what's my latest tweet" }),
      type: "create",
    });
    apply({
      at: DAY,
      chatId: CHAT,
      id: "a",
      type: "claim",
      words: "what's my latest tweet",
    });
    const copy = read();
    apply({ id: "a", type: "sent" });

    store.reconcile();
    expect(store.snapshot().drafts).toEqual([]);

    // A sync engine bringing back its copy of the file.
    fs.mkdirSync(path.dirname(fileOf()), { recursive: true });
    fs.writeFileSync(fileOf(), copy);
    store.reconcile();

    expect(store.snapshot().drafts).toEqual([]);
    expect(tree()).toEqual([]);
  });

  it("leaves a draft on its way still on its way, and still a new chat's", () => {
    const { apply, store } = open();
    apply({ draft: draft("a", { words: "hi" }), type: "create" });
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "hi" });
    fs.writeFileSync(fileOf(), read().replace("hi", "hi there"));

    store.reconcile();

    const [sending] = store.snapshot().drafts;
    expect(sending).toMatchObject({ sendingTo: CHAT, words: "hi there" });
    expect(sending?.chatId).toBeUndefined();
  });

  it("reads a conflict copy beside its original as the one draft, leaving the copy where it is", () => {
    const { apply } = open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    fs.copyFileSync(fileOf(), fileOf().replace("DRAFT.md", "DRAFT 2.md"));

    const again = open();

    expect(again.store.snapshot().drafts).toHaveLength(1);
    expect(tree()).toHaveLength(2);
  });
});

describe("a paste into a draft", () => {
  const PNG = Buffer.from("not really a png").toString("base64");

  it("lands in the draft's own folder, made for it, the second of one name numbered", () => {
    const { apply, store } = open();
    apply({ draft: draft("d1"), type: "create" });
    const first = store.stage({
      content: PNG,
      draftId: "d1",
      itemId: "a",
      name: "image.png",
    });
    const second = store.stage({
      content: PNG,
      draftId: "d1",
      itemId: "b",
      name: "image.png",
    });

    expect(path.relative(root, path.dirname(first.path))).toBe(
      "Drafts/2026-10-19",
    );
    expect(path.dirname(second.path)).toBe(path.dirname(first.path));
    expect(path.basename(second.path)).toBe("image 2.png");
    expect(first.size).toBe(16);
  });

  it("rewrites an item handed over again rather than adding a copy", () => {
    const { apply, store } = open();
    apply({ draft: draft("d2"), type: "create" });
    const stage = () =>
      store.stage({
        content: PNG,
        draftId: "d2",
        itemId: "a",
        name: "notes.txt",
      });
    const first = stage();
    expect(stage().path).toBe(first.path);
    expect(tree()).toEqual([
      "Drafts/2026-10-19/DRAFT.md",
      "Drafts/2026-10-19/notes.txt",
    ]);
  });

  it.each(["../escape.png", "a/b.png", "..", ""])(
    "refuses %j as a name",
    (name) => {
      const { apply, store } = open();
      apply({ draft: draft("d1"), type: "create" });
      expect(() =>
        store.stage({ content: PNG, draftId: "d1", itemId: "a", name }),
      ).toThrow();
    },
  );

  it("refuses a draft the store does not have", () => {
    const { store } = open();
    expect(() =>
      store.stage({ content: PNG, draftId: "gone", itemId: "a", name: "a" }),
    ).toThrow();
  });
});
