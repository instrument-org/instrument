import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type AbsolutePath, AbsolutePathSchema } from "../../schemas/paths";
import {
  forgetMemories,
  forgetMemory,
  listMemories,
  memoryDigests,
  memoryHeadline,
  MemoryNameSchema,
  readMemory,
  saveMemory,
  moveMemoryFrontMatterToStore,
} from "./store";
import { getWorkspaceConfig } from "../workspace-config";
import { readMemoryRecords } from "./memory-records";

/** The workspace, whose `.instrument/devices/` holds the memory store. */
let root: string;
/** Its `Memory/`. */
let dir: AbsolutePath;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-store-test-"));
  dir = AbsolutePathSchema.parse(path.join(root, "Memory"));
  await fs.mkdir(dir);
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("MemoryNameSchema", () => {
  it.each(["pacific-time", "no-stevia", "roofer", "a1-b2"])(
    "takes %j",
    (name) => {
      expect(MemoryNameSchema.safeParse(name).success).toBe(true);
    },
  );

  it.each([
    "Pacific Time",
    "-leading",
    "trailing-",
    "two--hyphens",
    "",
    "ünïcode",
  ])("refuses %j", (name) => {
    expect(MemoryNameSchema.safeParse(name).success).toBe(false);
  });
});

describe("saveMemory", () => {
  it("writes a file of the memory's text alone, keeps its source in the store, and lists it back", async () => {
    const saved = await saveMemory(dir, {
      chat: ChatIdSchema.parse("2026-10-21-roofer-call"),
      name: "pacific-time",
      text: "You are on Pacific time and mornings are best for calls.",
    });

    expect(saved.replaced).toBe(false);
    expect(saved.memory.path).toBe(path.join(dir, "pacific-time.md"));
    expect(await fs.readFile(saved.memory.path, "utf8")).toBe(
      "You are on Pacific time and mornings are best for calls.\n",
    );
    expect((await readMemoryRecords(dir)).get("pacific-time.md")).toEqual({
      chat: "2026-10-21-roofer-call",
      updated: new Date(saved.memory.at).toISOString().replace(".000Z", "Z"),
    });

    const listed = await listMemories(dir);
    expect(listed).toEqual([saved.memory]);
    expect(await readMemory(dir, "pacific-time")).toEqual(saved.memory);
  });

  it("replaces what a name held, which is how a memory is corrected", async () => {
    await saveMemory(dir, { name: "sweetener", text: "No stevia." });

    const corrected = await saveMemory(dir, {
      name: "sweetener",
      text: "Stevia is fine; sucralose gives you headaches.",
    });

    expect(corrected.replaced).toBe(true);
    const listed = await listMemories(dir);
    expect(listed.map((memory) => memory.text)).toEqual([
      "Stevia is fine; sucralose gives you headaches.",
    ]);
  });

  it("keeps front matter it does not write when a memory is corrected", async () => {
    const file = path.join(dir, "sweetener.md");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      file,
      [
        "---",
        "updated: 2026-10-14T18:22:04Z",
        "project: Kitchen",
        "---",
        "No stevia.",
        "",
      ].join("\n"),
      "utf8",
    );

    await saveMemory(dir, { name: "sweetener", text: "Stevia is fine." });

    expect(await fs.readFile(file, "utf8")).toMatchInlineSnapshot(`
      "---
      project: Kitchen
      ---
      Stevia is fine.
      "
    `);
  });

  it("refuses an empty memory, a bad name, and one past the ceiling", async () => {
    await expect(saveMemory(dir, { name: "x", text: "  " })).rejects.toThrow(
      "needs some text",
    );
    await expect(
      saveMemory(dir, { name: "Not A Slug", text: "fine" }),
    ).rejects.toThrow();
    await expect(
      saveMemory(dir, { name: "long", text: "x".repeat(2001) }),
    ).rejects.toThrow("at most 2000");
    expect(await listMemories(dir)).toEqual([]);
  });

  it.each([
    ["its address", "instrument://chat/2026-10-21-zevia"],
    ["a bare id", "2026-10-21-zevia"],
  ])("reads the chat named by %s", async (_name, chat) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "zevia.md"),
      `---\nchat: ${chat}\nupdated: 2026-10-21T15:04:11Z\n---\nZevia is back in.\n`,
    );

    expect(await readMemory(dir, "zevia")).toMatchObject({
      at: Date.parse("2026-10-21T15:04:11Z"),
      chat: "2026-10-21-zevia",
    });
  });
});

describe("listMemories", () => {
  it("is empty for a folder that does not exist yet", async () => {
    expect(
      await listMemories(AbsolutePathSchema.parse(path.join(dir, "missing"))),
    ).toEqual([]);
  });

  it("reads a file the user wrote by hand, with no frontmatter", async () => {
    await fs.writeFile(
      path.join(dir, "address.md"),
      "Your address is 1420 Alder St, Portland.\n",
    );

    const [memory] = await listMemories(dir);
    expect(memory).toMatchObject({
      name: "address",
      text: "Your address is 1420 Alder St, Portland.",
    });
    expect(memory?.chat).toBeUndefined();
    expect(memory?.at).toBeGreaterThan(0);
  });

  it("orders newest first and skips what is not a memory", async () => {
    await fs.writeFile(
      path.join(dir, "older.md"),
      "---\nupdated: 2026-01-01T00:00:00Z\n---\nOlder.\n",
    );
    await fs.writeFile(
      path.join(dir, "newer.md"),
      "---\nupdated: 2026-02-01T00:00:00Z\n---\nNewer.\n",
    );
    await fs.writeFile(path.join(dir, ".DS_Store"), "");
    await fs.writeFile(path.join(dir, "notes.txt"), "not a memory");
    await fs.writeFile(path.join(dir, "empty.md"), "---\nat: x\n---\n\n");
    await fs.mkdir(path.join(dir, "folder.md"));

    const listed = await listMemories(dir);
    expect(listed.map((memory) => memory.name)).toEqual(["newer", "older"]);
  });
});

describe("forgetMemory", () => {
  it("deletes the file and its record, and hands back what it held", async () => {
    await saveMemory(dir, { name: "roofer", text: "Your roofer is Dave." });

    const forgotten = await forgetMemory(dir, "roofer");

    expect(forgotten?.text).toBe("Your roofer is Dave.");
    expect(await listMemories(dir)).toEqual([]);
    expect((await readMemoryRecords(dir)).has("roofer.md")).toBe(false);
    expect(await forgetMemory(dir, "roofer")).toBeUndefined();
  });
});

describe("forgetMemories", () => {
  it("drops several at once and says what they held", async () => {
    await saveMemory(dir, { name: "one", text: "One." });
    await saveMemory(dir, { name: "two", text: "Two." });
    await saveMemory(dir, { name: "three", text: "Three." });

    const forgotten = await forgetMemories(dir, ["one", "three", "missing"]);

    expect(forgotten.map((memory) => memory.name)).toEqual(["one", "three"]);
    const left = await listMemories(dir);
    expect(left.map((memory) => memory.name)).toEqual(["two"]);
  });

  it("does nothing for names it does not hold", async () => {
    await saveMemory(dir, { name: "one", text: "One." });

    expect(await forgetMemories(dir, ["nope"])).toEqual([]);
    const left = await listMemories(dir);
    expect(left).toHaveLength(1);
  });

  // The name is joined onto the folder, so a name that is not a slug is
  // refused before it becomes a path: `..` would otherwise reach out of the
  // folder to any Markdown file, and forget would delete it.
  it("refuses a name that would read or delete outside the folder", async () => {
    const outside = path.join(dir, "..", `outside-${path.basename(dir)}.md`);
    await fs.writeFile(outside, "Not a memory.\n");
    try {
      const escaped = `../outside-${path.basename(dir)}`;
      expect(await readMemory(dir, escaped)).toBeUndefined();
      expect(await forgetMemories(dir, [escaped])).toEqual([]);
      expect(await forgetMemory(dir, escaped)).toBeUndefined();
      expect(await fs.readFile(outside, "utf8")).toBe("Not a memory.\n");
    } finally {
      await fs.rm(outside, { force: true });
    }
  });
});

describe("memoryDigests", () => {
  it("is empty for nothing, and a memory's digest moves only when it changes", async () => {
    expect(memoryDigests([])).toEqual({});

    await saveMemory(dir, { name: "one", text: "One." });
    await saveMemory(dir, { name: "two", text: "Two." });
    const first = memoryDigests(await listMemories(dir));
    expect(Object.keys(first).sort()).toEqual(["one", "two"]);

    await saveMemory(dir, { name: "one", text: "One, corrected." });
    const second = memoryDigests(await listMemories(dir));
    expect(second.one).not.toBe(first.one);
    expect(second.two).toBe(first.two);

    await forgetMemory(dir, "one");
    expect(memoryDigests(await listMemories(dir))).toEqual({ two: first.two });
  });
});

describe("moveMemoryFrontMatterToStore", () => {
  const device = () => getWorkspaceConfig().deviceId;

  it("takes an earlier build's front matter into the store, leaving the text", async () => {
    await fs.writeFile(
      path.join(dir, "zevia.md"),
      "---\nchat: instrument://chat/2026-10-21-zevia\nupdated: 2026-10-21T15:04:11Z\nproject: Kitchen\n---\nZevia is back in.\n",
    );
    await fs.writeFile(
      path.join(dir, "roofer.md"),
      "---\nupdated: 2026-10-22T09:00:00Z\n---\nYour roofer is Dave.\n",
    );
    await fs.writeFile(path.join(dir, "address.md"), "1420 Alder St.\n");
    const before = await listMemories(dir);

    expect(await moveMemoryFrontMatterToStore(root, device()))
      .toMatchInlineSnapshot(`
      {
        "done": [
          "took roofer.md's front matter into the memory store",
          "took zevia.md's front matter into the memory store",
        ],
        "left": [],
      }
    `);

    expect(await fs.readFile(path.join(dir, "zevia.md"), "utf8"))
      .toMatchInlineSnapshot(`
      "---
      project: Kitchen
      ---
      Zevia is back in.
      "
    `);
    expect(await fs.readFile(path.join(dir, "roofer.md"), "utf8")).toBe(
      "Your roofer is Dave.\n",
    );
    expect(Object.fromEntries(await readMemoryRecords(dir)))
      .toMatchInlineSnapshot(`
      {
        "roofer.md": {
          "updated": "2026-10-22T09:00:00Z",
        },
        "zevia.md": {
          "chat": "2026-10-21-zevia",
          "updated": "2026-10-21T15:04:11Z",
        },
      }
    `);
    // What Settings › Memory shows is the same before and after.
    expect(await listMemories(dir)).toEqual(before);
    expect(await moveMemoryFrontMatterToStore(root, device())).toEqual({
      done: [],
      left: [],
    });
  });

  it("takes the first betas' from, thread and at into the store, the thread as its chat", async () => {
    const chat = path.join(root, ".instrument", "chats", "2026-09-19-import");
    await fs.mkdir(chat, { recursive: true });
    await fs.writeFile(
      path.join(chat, "ses_01M2XW1SK8HN5PW5TA1M3JDQKP.dev_A1B2C3D4.jsonl"),
      "",
    );
    await fs.writeFile(
      path.join(dir, "two-macs.md"),
      '---\nfrom: "Importing my facts"\nthread: "ses_01M2XW1SK8HN5PW5TA1M3JDQKP"\nat: 2026-09-19T22:28:58.837Z\n---\nYou work across two Macs.\n',
    );
    await fs.writeFile(
      path.join(dir, "gone.md"),
      '---\nfrom: "Deleted chat"\nthread: "ses_01M2XW1SK8HN5PW5TA1M3JDQKQ"\nat: 2026-09-20T10:00:00Z\n---\nThe chat is gone.\n',
    );
    await fs.writeFile(
      path.join(dir, "mine.md"),
      "---\nat: home\n---\nKeys by the door.\n",
    );

    await moveMemoryFrontMatterToStore(root, device());

    expect(await fs.readFile(path.join(dir, "two-macs.md"), "utf8")).toBe(
      "You work across two Macs.\n",
    );
    expect(await fs.readFile(path.join(dir, "gone.md"), "utf8")).toBe(
      "The chat is gone.\n",
    );
    expect(await fs.readFile(path.join(dir, "mine.md"), "utf8")).toBe(
      "---\nat: home\n---\nKeys by the door.\n",
    );
    expect(Object.fromEntries(await readMemoryRecords(dir)))
      .toMatchInlineSnapshot(`
      {
        "gone.md": {
          "updated": "2026-09-20T10:00:00Z",
        },
        "two-macs.md": {
          "chat": "2026-09-19-import",
          "updated": "2026-09-19T22:28:58Z",
        },
      }
    `);
  });

  it("lets a memory saved since the file was written outrank it", async () => {
    await saveMemory(dir, { name: "roofer", text: "Your roofer is Dave." });
    const { at } = (await readMemory(dir, "roofer")) ?? { at: 0 };
    const file = path.join(dir, "roofer.md");
    // An older build on another computer writes its front matter back.
    await fs.writeFile(
      file,
      "---\nupdated: 2026-01-01T00:00:00Z\n---\nYour roofer is Dave.\n",
    );
    const past = new Date("2026-01-01T00:00:00Z");
    await fs.utimes(file, past, past);

    await moveMemoryFrontMatterToStore(root, device());

    expect((await readMemory(dir, "roofer"))?.at).toBe(at);
    expect(await fs.readFile(file, "utf8")).toBe("Your roofer is Dave.\n");
  });
});

describe("memoryHeadline", () => {
  it("is the first line", () => {
    expect(
      memoryHeadline("You like the short answer first.\n\nThe reasons after."),
    ).toBe("You like the short answer first.");
  });
});
