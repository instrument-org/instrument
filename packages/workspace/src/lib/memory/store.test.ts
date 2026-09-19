import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
} from "./store";

let dir: AbsolutePath;

beforeEach(async () => {
  dir = AbsolutePathSchema.parse(
    await fs.mkdtemp(path.join(os.tmpdir(), "memory-store-test-")),
  );
});

afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
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
  it("writes a file the user can read, and lists it back", async () => {
    const saved = await saveMemory(dir, {
      from: { sessionId: "ses_1", title: "Roofer call" },
      name: "pacific-time",
      text: "You are on Pacific time and mornings are best for calls.",
    });

    expect(saved.replaced).toBe(false);
    expect(saved.memory.path).toBe(path.join(dir, "pacific-time.md"));
    const file = await fs.readFile(saved.memory.path, "utf8");
    expect(file).toMatch(
      /^---\nfrom: "Roofer call"\nthread: "ses_1"\nat: \d{4}-\d{2}-\d{2}T[^\n]+\n---\nYou are on Pacific time and mornings are best for calls.\n$/,
    );

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

  it("keeps a title with a colon and quotes through the round trip", async () => {
    const title = 'Caffeine: the "Zevia" thread';
    await saveMemory(dir, {
      from: { title },
      name: "zevia",
      text: "Zevia is back in.",
    });

    const memory = await readMemory(dir, "zevia");
    expect(memory?.from).toEqual({ title });
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
    expect(memory?.from).toBeUndefined();
    expect(memory?.at).toBeGreaterThan(0);
  });

  it("orders newest first and skips what is not a memory", async () => {
    await fs.writeFile(
      path.join(dir, "older.md"),
      "---\nat: 2026-01-01T00:00:00.000Z\n---\nOlder.\n",
    );
    await fs.writeFile(
      path.join(dir, "newer.md"),
      "---\nat: 2026-02-01T00:00:00.000Z\n---\nNewer.\n",
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
  it("deletes the file and hands back what it held", async () => {
    await saveMemory(dir, { name: "roofer", text: "Your roofer is Dave." });

    const forgotten = await forgetMemory(dir, "roofer");

    expect(forgotten?.text).toBe("Your roofer is Dave.");
    expect(await listMemories(dir)).toEqual([]);
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

describe("memoryHeadline", () => {
  it("is the first line", () => {
    expect(
      memoryHeadline("You like the short answer first.\n\nThe reasons after."),
    ).toBe("You like the short answer first.");
  });
});
