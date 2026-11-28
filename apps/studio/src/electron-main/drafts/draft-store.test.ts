import { type Draft, type DraftOp, type DraftsSnapshot } from "@/shared/drafts";
import {
  type ChatId,
  folderProjectId,
} from "@instrument-org/workspace/electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The workspace's own config module, the one `saveProjectId` reads the
// running device from, which the package does not export.
import {
  getWorkspaceConfig,
  hasWorkspaceConfig,
  setWorkspaceConfig,
} from "../../../../../packages/workspace/src/lib/workspace-config";
import { createDraftStore, PHONE_DRAFTS_RECHECK_MS } from "./draft-store";

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
  // Only the device a project record is written as is read here, so the rest
  // of the config is left unset.
  setWorkspaceConfig({
    ...(hasWorkspaceConfig() ? getWorkspaceConfig() : {}),
    deviceId: "dev_TESTDEV1",
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
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
async function open() {
  const told: DraftsSnapshot[] = [];
  const store = createDraftStore({
    deviceId: "dev_here",
    moveToTrash: (target) => {
      fs.renameSync(target, path.join(trashDir, path.basename(target)));
      return Promise.resolve();
    },
    onChange: (snapshot) => told.push(snapshot),
    rootDir: root,
    timeZone: "UTC",
  });
  await store.load();
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
  path.join(root, ".instrument", "drafts", folder, "DRAFT.md");

const read = (folder?: string) => fs.readFileSync(fileOf(folder), "utf8");

describe("a window's ops", () => {
  it("write a draft once there is something in it, in a folder named for the day it was started", async () => {
    const { apply, store, told } = await open();

    apply({ draft: draft("a"), type: "create" });
    expect(tree()).toEqual([]);

    apply({
      at: DAY,
      id: "a",
      set: { words: "Plan the trip" },
      type: "update",
    });
    expect(tree()).toEqual([".instrument/drafts/2026-10-19/DRAFT.md"]);
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

  // A folder the person made in Projects/ goes by an id drawn from its name
  // until something keeps that id, so a draft filed under it writes it down,
  // and renaming the folder before the draft is sent keeps the draft in it.
  it("write down the id of a project a draft is filed under", async () => {
    fs.mkdirSync(path.join(root, "Projects", "Travel"), { recursive: true });
    const id = folderProjectId("Travel");
    const { apply } = await open();

    apply({
      draft: draft("a", {
        projectId: id,
        projectSource: "chosen",
        words: "Plan the trip",
      }),
      type: "create",
    });
    await vi.waitFor(() => {
      expect(projectRecordLines()).toContain(id);
    });
    fs.renameSync(
      path.join(root, "Projects", "Travel"),
      path.join(root, "Projects", "Trips"),
    );

    expect(read()).toContain(`project: "${id}"`);
    expect(
      fs.existsSync(path.join(root, "Projects", "Trips", "AGENTS.md")),
    ).toBe(false);
  });

  it("take a thrown-away draft away, with what was pasted into it moved to the Trash", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a"), type: "create" });
    const pasted = await store.stage({
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

  it("write the asks moved into a draft, and read them back after a relaunch", async () => {
    const { apply } = await open();
    const notes = path.join(root, "notes.md");
    apply({
      draft: draft("a", {
        asks: [
          {
            createdAt: DAY + 5,
            excerpt: "Ship it",
            id: "staged-1",
            instruction: "Is this still true?",
            path: notes,
            target: "line 3",
          },
        ],
      }),
      type: "create",
    });

    expect(read()).toMatchInlineSnapshot(`
      "---
      id: "a"
      created: 2026-10-19T12:00:00Z
      updated: 2026-10-19T12:00:00Z
      asks:
        - file: "workspace:/notes.md"
          target: "line 3"
          excerpt: "Ship it"
          instruction: "Is this still true?"
      ---


      "
    `);
    expect((await open()).store.snapshot().drafts[0]?.asks).toEqual([
      {
        createdAt: DAY,
        excerpt: "Ship it",
        id: "a-ask-0",
        instruction: "Is this still true?",
        path: notes,
        target: "line 3",
      },
    ]);
  });

  it("write what goes with the message as context, and read it back as chips and the composer's", async () => {
    const { apply, store } = await open();
    const plans = path.join(root, "Kitchen plans");
    apply({
      draft: draft("a", {
        context: [
          { chat: CHAT, kind: "chat" },
          { kind: "folder", path: plans },
          { kind: "link", url: "https://example.com/" },
        ],
        projectId: "top_1",
        projectSource: "suggested",
        words: "Plan",
      }),
      type: "create",
    });
    const pasted = await store.stage({
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

    // A project the model suggested is the window's alone.
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

    const reopened = (await open()).store.snapshot().drafts[0];
    const image = {
      kind: "file" as const,
      mediaType: "image/png",
      name: "image.png",
      path: pasted.path,
      size: 3,
    };
    expect(reopened).toEqual(
      draft("a", {
        attached: [image, { kind: "folder", path: plans }],
        folder: path.dirname(pasted.path),
        inFolder: [image],
        context: [
          { chat: CHAT, kind: "chat" },
          { kind: "link", url: "https://example.com/" },
        ],
        words: "Plan",
      }),
    );
  });

  it("take a file given from elsewhere back out once the person does, after a relaunch", async () => {
    const { apply } = await open();
    const notes = path.join(root, "notes.md");
    fs.writeFileSync(notes, "hi");
    apply({
      draft: draft("a", {
        attached: [
          {
            kind: "file",
            mediaType: "text/markdown",
            name: "notes.md",
            path: notes,
            size: 2,
          },
        ],
        words: "Read",
      }),
      type: "create",
    });

    const again = await open();
    expect(again.store.snapshot().drafts[0]?.attached).toEqual([
      expect.objectContaining({ kind: "file", path: notes, size: 2 }),
    ]);
    again.apply({
      at: DAY,
      id: "a",
      set: {},
      type: "update",
      unset: ["attached"],
    });
    expect(read()).not.toContain("notes.md");
  });

  it("point a draft being sent at its chat on disk, with the words it is sent with, before they answer", async () => {
    const { apply } = await open();
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
    expect(read()).toContain('sender: "dev_here"');
    expect(read()).not.toContain("chat:");
    expect(read()).toContain("what's my latest tweet");
  });

  it("take the send off again when it fails, the draft the kind it was", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a", { words: "hi" }), type: "create" });
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "hi" });

    apply({ id: "a", type: "release" });

    expect(read()).not.toContain("sending:");
    expect(store.snapshot().drafts[0]).toEqual(
      draft("a", { folder: path.dirname(fileOf()), words: "hi" }),
    );
  });

  it("keep front matter another program left", async () => {
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
    const { apply, store } = await open();
    expect(store.snapshot().drafts[0]).toEqual(
      draft("a", { folder: path.dirname(fileOf()), words: "Plan" }),
    );

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
  it("is not told of the store's own writes", async () => {
    const { apply, store, told } = await open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    const heard = told.length;

    await store.reconcile();

    expect(told).toHaveLength(heard);
  });

  it("reads no draft's file again where none changed", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    apply({ draft: draft("b", { words: "Pack" }), type: "create" });
    await store.reconcile();
    const opened = vi.spyOn(fs.promises, "open");

    await store.reconcile();

    expect(opened).not.toHaveBeenCalled();
  });

  it("never takes in a file read before the store's own write over it", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    fs.writeFileSync(fileOf(), read().replace("Plan", "Plan the trip"));
    // The look opens the file as it is now, and reads it only once the
    // window's next change has been written over it.
    const open_ = fs.promises.open;
    let written = () => {};
    const writing = new Promise<void>((done) => {
      written = done;
    });
    vi.spyOn(fs.promises, "open").mockImplementationOnce(async (...args) => {
      const handle = await open_(...args);
      await writing;
      return handle;
    });

    const looked = store.reconcile();
    await vi.waitFor(
      () => {
        expect(fs.promises.open).toHaveBeenCalled();
      },
      { interval: 1 },
    );
    apply({
      at: DAY,
      id: "a",
      set: { words: "Plan the trip to Lisbon" },
      type: "update",
    });
    written();
    await looked;

    expect(store.snapshot().drafts.map((entry) => entry.words)).toEqual([
      "Plan the trip to Lisbon",
    ]);
  });

  it("takes in a draft edited, added, or deleted there", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    fs.writeFileSync(fileOf(), read().replace("Plan", "Plan the trip"));
    fs.mkdirSync(path.join(root, ".instrument", "drafts", "copied in"));
    fs.writeFileSync(
      path.join(root, ".instrument", "drafts", "copied in", "DRAFT.md"),
      '---\nid: "b"\ncreated: 2026-10-19T13:00:00.000Z\n---\n\nFrom the phone\n',
    );

    await store.reconcile();
    expect(store.snapshot().drafts.map((entry) => entry.words)).toEqual([
      "Plan the trip",
      "From the phone",
    ]);

    fs.rmSync(fileOf());
    await store.reconcile();
    expect(store.snapshot().drafts.map((entry) => entry.id)).toEqual(["b"]);
  });

  // What the inbox once showed as Draft on a chat that had just been
  // started: the draft was pointed at its chat behind the store's back, and
  // the change the watcher found for it read as one made elsewhere.
  it("never brings back a draft finished", async () => {
    const { apply, store } = await open();
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
    apply({ id: "a", messageId: "m1", type: "sent" });
    apply({ id: "a", type: "finish" });

    await store.reconcile();
    expect(store.snapshot().drafts).toEqual([]);

    // A sync engine bringing back its copy of the file.
    fs.mkdirSync(path.dirname(fileOf()), { recursive: true });
    fs.writeFileSync(fileOf(), copy);
    await store.reconcile();

    expect(store.snapshot().drafts).toEqual([]);
    expect(tree()).toEqual([]);
  });

  it("leaves a draft this app has on its way on its way, whatever its file says meanwhile", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a", { words: "hi" }), type: "create" });
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "hi" });
    // Another device's launch finding the send unfinished.
    fs.writeFileSync(
      fileOf(),
      read()
        .replace(`sending: instrument://chat/${CHAT}\n`, "")
        .replace("hi", "hi there"),
    );

    await store.reconcile();

    const [sending] = store.snapshot().drafts;
    expect(sending).toMatchObject({
      send: { chatId: CHAT, stage: "sending" },
      words: "hi there",
    });
    expect(sending?.chatId).toBeUndefined();
  });

  it("reads a conflict copy beside its original as the one draft, leaving the copy where it is", async () => {
    const { apply } = await open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    fs.copyFileSync(fileOf(), fileOf().replace("DRAFT.md", "DRAFT 2.md"));

    const again = await open();

    expect(again.store.snapshot().drafts).toHaveLength(1);
    expect(tree()).toHaveLength(2);
  });
});

describe("the drafts folder behind every window", () => {
  // A file in a folder inside a draft's folder is deeper than the watchers
  // reach, as a sync event the system dropped is never heard: only a read
  // of the folder finds it.
  it.each([
    { found: 1, hasPhone: true },
    { found: 0, hasPhone: false },
  ])(
    "is read on a timer only once a phone has used the workspace (phone: $hasPhone)",
    async ({ found, hasPhone }) => {
      const notes = path.join(
        root,
        ".instrument",
        "drafts",
        "2026-10-19",
        "notes",
      );
      fs.mkdirSync(notes, { recursive: true });
      const { store } = await open();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      let heard = 0;
      const stop = store.watch(
        () => {
          heard += 1;
        },
        { hasPhone: () => Promise.resolve(hasPhone) },
      );
      try {
        // The watchers' first reads, and the one after a phone is found.
        await new Promise((done) => setTimeout(done, 600));
        heard = 0;
        fs.writeFileSync(path.join(notes, "list.txt"), "milk\n");
        await new Promise((done) => setTimeout(done, 600));
        expect(heard).toBe(0);

        vi.advanceTimersByTime(PHONE_DRAFTS_RECHECK_MS);
        await new Promise((done) => setTimeout(done, 600));
        expect(heard).toBe(found);
      } finally {
        stop();
        vi.useRealTimers();
      }
    },
  );

  it("stops waiting for a phone when the watch stops", async () => {
    const { store } = await open();
    let asked: AbortSignal | undefined;
    const stop = store.watch(() => {}, {
      hasPhone: (signal) => {
        asked = signal;
        return new Promise<boolean>(() => {});
      },
    });
    expect(asked?.aborted).toBe(false);
    stop();
    expect(asked?.aborted).toBe(true);
  });
});

describe("what the folder has that the store has not read yet", () => {
  it("is taken in before a window's change is written over it", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    // Another device files the draft under a project, and its file arrives
    // before the watcher has said so.
    fs.writeFileSync(
      fileOf(),
      read().replace("---\n\nPlan", 'project: "travel"\n---\n\nPlan'),
    );

    apply({
      at: DAY,
      id: "a",
      set: { words: "Plan the trip" },
      type: "update",
    });

    expect(store.snapshot().drafts[0]).toMatchObject({
      projectId: "travel",
      words: "Plan the trip",
    });
    expect(read()).toContain('project: "travel"');
  });

  it("leaves a draft whose file cannot be read for the moment as it was", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a", { words: "Plan" }), type: "create" });
    // An editor partway through a save that is not atomic.
    fs.writeFileSync(fileOf(), "");

    await store.reconcile();

    expect(store.snapshot().drafts.map((entry) => entry.words)).toEqual([
      "Plan",
    ]);
  });

  it("takes in a draft another device has on its way as on its way", async () => {
    const { store } = await open();
    fs.mkdirSync(path.dirname(fileOf()), { recursive: true });
    fs.writeFileSync(
      fileOf(),
      `---\nid: "a"\ncreated: 2026-10-19T12:00:00.000Z\nsending: instrument://chat/${CHAT}\n---\n\nhi\n`,
    );

    await store.reconcile();

    const [sending] = store.snapshot().drafts;
    expect(sending).toMatchObject({ send: { chatId: CHAT, stage: "sending" } });
    expect(sending?.chatId).toBeUndefined();
  });
});

describe("a sync engine's conflict copy", () => {
  /** A draft, and a copy of its file beside it under a conflict copy's name. */
  async function copied(name: string) {
    const { apply } = await open();
    apply({ draft: draft("a", { words: "mine" }), type: "create" });
    const copy = path.join(path.dirname(fileOf()), name);
    fs.writeFileSync(copy, read().replace("mine", "theirs"));
    return copy;
  }

  it.each(["DRAFT 2.md", "DRAFT (conflicted copy).md"])(
    "named %j is never the draft",
    async (name) => {
      await copied(name);
      const { store } = await open();
      expect(store.snapshot().drafts.map((entry) => entry.words)).toEqual([
        "mine",
      ]);
      await store.reconcile();
      expect(store.snapshot().drafts.map((entry) => entry.words)).toEqual([
        "mine",
      ]);
    },
  );

  it("goes with the draft when the draft is thrown away", async () => {
    const copy = await copied("DRAFT 2.md");
    const { apply, store } = await open();

    apply({ id: "a", type: "remove" });
    await store.reconcile();

    expect(fs.existsSync(copy)).toBe(false);
    expect(store.snapshot().drafts).toEqual([]);
  });
});

describe("a paste into a draft", () => {
  const PNG = Buffer.from("not really a png").toString("base64");

  it("lands in the draft's own folder, made for it, the second of one name numbered", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("d1"), type: "create" });
    const first = await store.stage({
      content: PNG,
      draftId: "d1",
      itemId: "a",
      name: "image.png",
    });
    const second = await store.stage({
      content: PNG,
      draftId: "d1",
      itemId: "b",
      name: "image.png",
    });

    expect(path.relative(root, path.dirname(first.path))).toBe(
      ".instrument/drafts/2026-10-19",
    );
    expect(path.dirname(second.path)).toBe(path.dirname(first.path));
    expect(path.basename(second.path)).toBe("image 2.png");
    expect(first.size).toBe(16);
  });

  it("rewrites an item handed over again rather than adding a copy", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("d2"), type: "create" });
    const stage = () =>
      store.stage({
        content: PNG,
        draftId: "d2",
        itemId: "a",
        name: "notes.txt",
      });
    const first = await stage();
    expect((await stage()).path).toBe(first.path);
    expect(tree()).toEqual([
      ".instrument/drafts/2026-10-19/DRAFT.md",
      ".instrument/drafts/2026-10-19/notes.txt",
    ]);
  });

  it.each(["../escape.png", "a/b.png", "..", ""])(
    "refuses %j as a name",
    async (name) => {
      const { apply, store } = await open();
      apply({ draft: draft("d1"), type: "create" });
      await expect(
        store.stage({ content: PNG, draftId: "d1", itemId: "a", name }),
      ).rejects.toThrow();
    },
  );

  it("goes with its draft even when the draft was thrown away before it said so", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("d3", { words: "see this" }), type: "create" });
    await store.stage({
      content: PNG,
      draftId: "d3",
      itemId: "a",
      name: "a.png",
    });

    apply({ id: "d3", type: "remove" });
    await settle();

    expect(tree()).toEqual([]);
    expect(trashed()).toEqual(["a.png"]);
  });

  it("refuses a draft the store does not have", async () => {
    const { store } = await open();
    await expect(
      store.stage({ content: PNG, draftId: "gone", itemId: "a", name: "a" }),
    ).rejects.toThrow();
  });

  it("numbers two pastes of one name made at once", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("d4"), type: "create" });
    const paste = (itemId: string) =>
      store.stage({ content: PNG, draftId: "d4", itemId, name: "image.png" });
    const both = await Promise.all([paste("a"), paste("b")]);

    expect(both.map((each) => path.basename(each.path))).toEqual([
      "image.png",
      "image 2.png",
    ]);
  });

  it("goes to the Trash when its draft is thrown away as it is written", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("d5", { words: "see this" }), type: "create" });
    const pasting = store.stage({
      content: PNG,
      draftId: "d5",
      itemId: "a",
      name: "a.png",
    });
    apply({ id: "d5", type: "remove" });

    await expect(pasting).rejects.toThrow();
    await settle();
    expect(tree()).toEqual([]);
    expect(trashed()).toContain("a.png");
  });
});

describe("a draft's folder as what goes with it", () => {
  /** A draft with words, on disk, and its folder. */
  async function written() {
    const opened = await open();
    opened.apply({ draft: draft("a", { words: "Look" }), type: "create" });
    return { ...opened, dir: path.dirname(fileOf()) };
  }

  it("takes in a file dropped into the folder from outside the app, and lets it go when it is taken out", async () => {
    const { dir, store, told } = await written();
    const dropped = path.join(dir, "quote.pdf");
    fs.writeFileSync(dropped, "%PDF");
    fs.writeFileSync(path.join(dir, ".DS_Store"), "");

    await store.reconcile();
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
    await store.reconcile();
    expect(told.length).toBe(heard);

    fs.rmSync(dropped);
    await store.reconcile();
    expect(store.snapshot().drafts[0]?.inFolder).toBeUndefined();
  });

  it("keeps the words a window gave it when only the folder changed", async () => {
    const { apply, dir, store } = await written();
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

    await store.reconcile();

    const now = store.snapshot().drafts[0];
    expect(now?.attached?.map((item) => item.path)).toEqual([outside]);
    expect(now?.inFolder?.map((item) => item.path)).toEqual([
      path.join(dir, "dropped.png"),
    ]);
  });

  it("moves a file whose chip was taken off to the Trash, and nothing outside the folder", async () => {
    const { dir, store } = await written();
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

  it("keeps a sent draft's folder whole until the draft finishes", async () => {
    const { apply, dir } = await written();
    const sent = path.join(dir, "receipt.pdf");
    fs.writeFileSync(sent, "%PDF");
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "Look" });
    apply({
      carried: { files: [sent], folders: [] },
      id: "a",
      messageId: "m1",
      type: "sent",
    });
    await settle();

    expect(fs.existsSync(sent)).toBe(true);
    expect(read()).toContain(`sending: instrument://chat/${CHAT}\nsent: "m1"`);
  });

  it("takes what a finished draft's message carried out of its folder, and moves what came later to the Trash", async () => {
    const { apply, dir } = await written();
    const sent = path.join(dir, "receipt.pdf");
    fs.writeFileSync(sent, "%PDF");
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "Look" });
    apply({
      carried: { files: [sent], folders: [] },
      id: "a",
      messageId: "m1",
      type: "sent",
    });
    // Landed after the send read the folder, so it never went.
    fs.writeFileSync(path.join(dir, "late.pdf"), "%PDF");
    apply({ id: "a", type: "finish" });
    await settle();

    expect(tree()).toEqual([]);
    expect(trashed()).toEqual(["late.pdf"]);
  });

  it("gives a draft taken back the person again, folder and all", async () => {
    const { apply, dir, store } = await written();
    const sent = path.join(dir, "receipt.pdf");
    fs.writeFileSync(sent, "%PDF");
    apply({ at: DAY, chatId: CHAT, id: "a", type: "claim", words: "Look" });
    apply({
      carried: { files: [sent], folders: [] },
      id: "a",
      messageId: "m1",
      type: "sent",
    });
    apply({ id: "a", type: "release" });
    await store.reconcile();

    const [back] = store.snapshot().drafts;
    expect(back?.send).toBeUndefined();
    expect(back?.inFolder?.map((item) => item.path)).toEqual([sent]);
    expect(read()).not.toContain("sending:");
    expect(read()).not.toContain("sent:");
    expect(trashed()).toEqual([]);
  });

  it.each(["..", "."])(
    "never moves the folder itself or the one around it, by %j",
    async (name) => {
      const { dir, store } = await written();
      await store.trash({ draftId: "a", path: `${dir}/${name}` });
      expect(trashed()).toEqual([]);
      expect(fs.existsSync(fileOf())).toBe(true);
    },
  );

  it("leaves a file another draft in a shared folder still names", async () => {
    const { dir, store } = await written();
    const shared = path.join(dir, "receipt.pdf");
    fs.writeFileSync(shared, "%PDF");
    fs.writeFileSync(
      path.join(dir, "DRAFT 2.md"),
      '---\nid: "b"\ncontext:\n  - "receipt.pdf"\n---\n\nTheirs\n',
    );

    await store.trash({ draftId: "a", path: shared });

    expect(trashed()).toEqual([]);
    expect(fs.existsSync(shared)).toBe(true);
  });
});

/** Every device's lines in the projects synced store, as one string. */
function projectRecordLines(): string {
  const devices = path.join(root, ".instrument", "devices");
  if (!fs.existsSync(devices)) {
    return "";
  }
  return fs
    .readdirSync(devices)
    .map((device) => path.join(devices, device, "projects.jsonl"))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("");
}

describe("discarding", () => {
  it("moves a draft's whole folder to the Trash, and its words with it", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a", { words: "Left behind" }), type: "create" });
    await store.reconcile();

    await store.discard(["a"]);

    expect(trashed()).toEqual(["2026-10-19"]);
    expect(
      fs.readFileSync(path.join(trashDir, "2026-10-19", "DRAFT.md"), "utf8"),
    ).toContain("Left behind");
    expect(store.snapshot().drafts).toEqual([]);
  });

  it("leaves a folder with anything else in it, and words changed elsewhere", async () => {
    const { apply, store } = await open();
    apply({ draft: draft("a", { words: "With a file" }), type: "create" });
    await store.reconcile();
    const extra = path.join(path.dirname(fileOf()), "photo.png");
    fs.writeFileSync(extra, "x");
    await store.discard(["a"]);
    fs.rmSync(extra);
    fs.writeFileSync(fileOf(), read().replace("With a file", "Changed"));
    await store.discard(["a"]);

    expect(trashed()).toEqual([]);
    expect(read()).toContain("Changed");
  });
});
