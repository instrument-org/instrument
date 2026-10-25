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
/** Where the test's Trash is, outside the workspace. */
let trashDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "draft-store-"));
  trashDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-store-trash-"));
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
  fs.rmSync(trashDir, { force: true, recursive: true });
});

/** What went to the Trash, by name. */
const trashed = () => fs.readdirSync(trashDir).toSorted();

/** Lets the moves to the Trash a removal started finish. */
const settle = () => new Promise((done) => setImmediate(done));

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
    moveToTrash: (target) => {
      fs.renameSync(target, path.join(trashDir, path.basename(target)));
      return Promise.resolve();
    },
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
      created: 2026-10-19T12:00:00Z
      updated: 2026-10-19T12:00:00Z
      ---

      Plan the trip
      "
    `);
    expect(told.at(-1)).toEqual({
      acks: { window: 2 },
      drafts: store.snapshot().drafts,
    });
  });

  it("take a thrown-away draft away, with what was pasted into it moved to the Trash", async () => {
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
            mediaType: "image/png",
            name: "image.png",
            path: pasted.path,
            size: pasted.size,
          },
        ],
      },
      type: "update",
    });
    // In the draft's own folder, so it goes with the draft without a line.
    expect(read()).not.toContain("image.png");

    apply({ id: "a", type: "remove" });
    await settle();

    expect(tree()).toEqual([]);
    expect(trashed()).toEqual(["image.png"]);
  });

  it("write what goes with the message as context, and read it back as chips and the composer's", () => {
    const { apply, store } = open();
    const plans = path.join(root, "Kitchen plans");
    apply({
      draft: draft("a", {
        context: [
          { chat: CHAT, kind: "chat" },
          { kind: "folder", path: plans },
          { kind: "link", url: "https://example.com/" },
        ],
        topicId: "top_1",
        topicSource: "suggested",
        words: "Plan",
      }),
      type: "create",
    });
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
            mediaType: "image/png",
            name: "image.png",
            path: pasted.path,
            size: pasted.size,
          },
        ],
      },
      type: "update",
    });

    // A topic the model suggested is the window's alone.
    expect(read()).toMatchInlineSnapshot(`
      "---
      id: "a"
      created: 2026-10-19T12:00:00Z
      updated: 2026-10-19T12:00:00Z
      context:
        - "instrument://chat/2026-10-19-what-s-my-latest-tweet"
        - "workspace:/Kitchen plans/"
        - "https://example.com/"
      ---

      Plan
      "
    `);

    const reopened = open().store.snapshot().drafts[0];
    const image = {
      kind: "file" as const,
      mediaType: "image/png",
      name: "image.png",
      path: pasted.path,
      size: 3,
    };
    expect(reopened).toEqual(
      draft("a", {
        attached: [image],
        inFolder: [image],
        context: [
          { chat: CHAT, kind: "chat" },
          { kind: "folder", path: plans },
          { kind: "link", url: "https://example.com/" },
        ],
        words: "Plan",
      }),
    );
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

    expect(read()).toContain(`sending: instrument://chat/${CHAT}`);
    expect(read()).not.toContain("chat:");
    expect(read()).toContain("what's my latest tweet");
  });

  it("take the send off again when it fails, the draft the kind it was", () => {
    const { apply, store } = open();
    apply({ draft: draft("a", { words: "hi" }), type: "create" });
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "hi" });

    apply({ id: "a", type: "release" });

    expect(read()).not.toContain("sending:");
    expect(store.snapshot().drafts[0]).toEqual(draft("a", { words: "hi" }));
  });

  it("keep front matter another program left", () => {
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
    expect(store.snapshot().drafts[0]).toEqual(draft("a", { words: "Plan" }));

    apply({
      at: DAY,
      id: "a",
      set: { words: "Plan the trip" },
      type: "update",
    });

    expect(read()).toContain("state:\n  leftOut: not a list\n  pinned: true");
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

  it("leaves a draft this app has on its way on its way, whatever its file says meanwhile", () => {
    const { apply, store } = open();
    apply({ draft: draft("a", { words: "hi" }), type: "create" });
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "hi" });
    // Another device's launch finding the send unfinished.
    fs.writeFileSync(
      fileOf(),
      read()
        .replace(`sending: instrument://chat/${CHAT}\n`, "")
        .replace("hi", "hi there"),
    );

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

describe("what the folder has that the store has not read yet", () => {
  it("is taken in before a window's change is written over it", () => {
    const { apply, store } = open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    // Another device files the draft under a topic, and its file arrives
    // before the watcher has said so.
    fs.writeFileSync(
      fileOf(),
      read().replace("---\n\nPlan", 'topic: "travel"\n---\n\nPlan'),
    );

    apply({
      at: DAY,
      id: "a",
      set: { words: "Plan the trip" },
      type: "update",
    });

    expect(store.snapshot().drafts[0]).toMatchObject({
      topicId: "travel",
      words: "Plan the trip",
    });
    expect(read()).toContain('topic: "travel"');
  });

  it("leaves a draft whose file cannot be read for the moment as it was", () => {
    const { apply, store } = open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    // An editor partway through a save that is not atomic.
    fs.writeFileSync(fileOf(), "");

    store.reconcile();

    expect(store.snapshot().drafts.map((entry) => entry.words)).toEqual([
      "Plan",
    ]);
  });

  it("takes in a draft another device has on its way as on its way", () => {
    const { store } = open();
    fs.mkdirSync(path.dirname(fileOf()), { recursive: true });
    fs.writeFileSync(
      fileOf(),
      `---\nid: "a"\ncreated: 2026-10-19T12:00:00.000Z\nsending: instrument://chat/${CHAT}\n---\n\nhi\n`,
    );

    store.reconcile();

    const [sending] = store.snapshot().drafts;
    expect(sending).toMatchObject({ sendingTo: CHAT });
    expect(sending?.chatId).toBeUndefined();
  });
});

describe("a sync engine's conflict copy", () => {
  /** A draft, and a copy of its file beside it under a conflict copy's name. */
  function copied(name: string) {
    const { apply } = open();
    apply({ draft: draft("a", { words: "mine" }), type: "create" });
    const copy = path.join(path.dirname(fileOf()), name);
    fs.writeFileSync(copy, read().replace("mine", "theirs"));
    return copy;
  }

  it.each(["DRAFT 2.md", "DRAFT (conflicted copy).md"])(
    "named %j is never the draft",
    (name) => {
      copied(name);
      const { store } = open();
      expect(store.snapshot().drafts.map((entry) => entry.words)).toEqual([
        "mine",
      ]);
      store.reconcile();
      expect(store.snapshot().drafts.map((entry) => entry.words)).toEqual([
        "mine",
      ]);
    },
  );

  it("goes with the draft when the draft is thrown away", () => {
    const copy = copied("DRAFT 2.md");
    const { apply, store } = open();

    apply({ id: "a", type: "remove" });
    store.reconcile();

    expect(fs.existsSync(copy)).toBe(false);
    expect(store.snapshot().drafts).toEqual([]);
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

  it("goes with its draft even when the draft was thrown away before it said so", async () => {
    const { apply, store } = open();
    apply({ draft: draft("d3", { words: "see this" }), type: "create" });
    store.stage({ content: PNG, draftId: "d3", itemId: "a", name: "a.png" });

    apply({ id: "d3", type: "remove" });
    await settle();

    expect(tree()).toEqual([]);
    expect(trashed()).toEqual(["a.png"]);
  });

  it("refuses a draft the store does not have", () => {
    const { store } = open();
    expect(() =>
      store.stage({ content: PNG, draftId: "gone", itemId: "a", name: "a" }),
    ).toThrow();
  });
});

describe("a draft's folder as what goes with it", () => {
  /** A draft with words, on disk, and its folder. */
  function written() {
    const opened = open();
    opened.apply({ draft: draft("a", { words: "Look" }), type: "create" });
    return { ...opened, dir: path.dirname(fileOf()) };
  }

  it("takes in a file dropped into the folder from outside the app, and lets it go when it is taken out", () => {
    const { dir, store, told } = written();
    const dropped = path.join(dir, "quote.pdf");
    fs.writeFileSync(dropped, "%PDF");
    fs.writeFileSync(path.join(dir, ".DS_Store"), "");

    store.reconcile();
    const quote = {
      kind: "file",
      mediaType: "application/pdf",
      name: "quote.pdf",
      path: dropped,
      size: 4,
    };
    expect(store.snapshot().drafts[0]?.inFolder).toEqual([quote]);
    // Nothing in the folder is written as a line.
    expect(read()).not.toContain("quote.pdf");

    const heard = told.length;
    store.reconcile();
    expect(told.length).toBe(heard);

    fs.rmSync(dropped);
    store.reconcile();
    expect(store.snapshot().drafts[0]?.inFolder).toBeUndefined();
  });

  it("keeps the words a window gave it when only the folder changed", () => {
    const { apply, dir, store } = written();
    const outside = path.join(root, "notes.txt");
    fs.writeFileSync(outside, "mine");
    apply({
      id: "a",
      set: {
        attached: [
          {
            kind: "file",
            mediaType: "text/plain",
            name: "notes.txt",
            path: outside,
            size: 4,
          },
        ],
      },
      type: "update",
    });
    fs.writeFileSync(path.join(dir, "dropped.png"), "png");

    store.reconcile();

    const now = store.snapshot().drafts[0];
    expect(now?.attached?.map((item) => item.path)).toEqual([outside]);
    expect(now?.inFolder?.map((item) => item.path)).toEqual([
      path.join(dir, "dropped.png"),
    ]);
  });

  it("moves a file whose chip was taken off to the Trash, and nothing outside the folder", async () => {
    const { dir, store } = written();
    const dropped = path.join(dir, "quote.pdf");
    fs.writeFileSync(dropped, "%PDF");
    const outside = path.join(root, "notes.txt");
    fs.writeFileSync(outside, "mine");

    await store.trash({ draftId: "a", path: outside });
    await store.trash({ draftId: "a", path: fileOf() });
    await store.trash({ draftId: "a", path: dropped });

    expect(trashed()).toEqual(["quote.pdf"]);
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(fileOf())).toBe(true);
  });

  it("takes the files a sent draft's folder had with it, since the chat has its own copies", async () => {
    const { apply, dir } = written();
    fs.writeFileSync(path.join(dir, "quote.pdf"), "%PDF");
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "Look" });
    apply({ id: "a", type: "sent" });
    await settle();

    expect(tree()).toEqual([]);
    expect(trashed()).toEqual([]);
  });
});
