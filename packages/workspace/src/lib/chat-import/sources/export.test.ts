import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  chatGptRemodel,
  chatGptUntitled,
  claudeConversation,
  writeFolder,
  writeZip,
} from "../../../test/helpers/chat-exports";
import { withTempDir } from "../../../test/helpers/temp-dir";
import type { ChatSource } from "../model";
import { openExport } from "./export";
import { jsonArrayObjects } from "./export-files";

const dir = withTempDir("chat-export");

async function listed(chats: ChatSource) {
  return (await chats.list()).map(
    ({ sourceId, title, messages, incidental }) =>
      `${sourceId}: ${title} (${messages}${incidental ? ", incidental" : ""})`,
  );
}

async function readIds(chats: ChatSource, ids: string[]) {
  const found: string[] = [];
  for await (const transcript of chats.read(ids)) {
    found.push(transcript.sourceId);
  }
  return found;
}

const chatGptFiles = {
  "chat.html": "<html></html>",
  "user.json": JSON.stringify({ id: "user-1", email: "person@example.com" }),
  "message_feedback.json": "[]",
  "file-abc-tile.jpg": new Uint8Array(4096),
};

describe("openExport", () => {
  it("opens a ChatGPT zip with one conversations file", async () => {
    const zip = path.join(dir.path, "chatgpt-export.zip");
    await writeZip(zip, {
      ...chatGptFiles,
      // An unparseable conversation between two good ones.
      "conversations.json": `[${JSON.stringify(chatGptRemodel())},{"id": nope},${JSON.stringify(chatGptUntitled())}]`,
    });
    const { source, chats } = await openExport(zip);
    const { from, ...named } = source;
    expect(from).toEqual({ type: "export", path: zip });
    expect(named).toMatchInlineSnapshot(`
      {
        "kind": "chatgpt-export",
        "location": "chatgpt-export.zip",
        "name": "ChatGPT",
        "site": "https://chatgpt.com",
      }
    `);
    expect(await listed(chats)).toMatchInlineSnapshot(`
      [
        "gpt-untitled: What's a good name for a cat? (2)",
        "gpt-remodel: Kitchen remodel (4)",
      ]
    `);
    expect(await readIds(chats, ["gpt-untitled", "gone"]))
      .toMatchInlineSnapshot(`
      [
        "gpt-untitled",
      ]
    `);
  });

  it("opens a split ChatGPT export unpacked inside a folder of its own", async () => {
    const folder = path.join(dir.path, "Downloads-export");
    await writeFolder(folder, {
      "abc123/chat.html": "",
      "abc123/conversations-000.json": JSON.stringify([chatGptRemodel()]),
      "abc123/conversations-001.json": JSON.stringify([
        chatGptUntitled("gpt-a"),
        chatGptUntitled("gpt-b"),
      ]),
      "abc123/dalle-generations/file-1.webp": "",
    });
    const { source, chats } = await openExport(folder);
    expect(source.kind).toBe("chatgpt-export");
    expect(source.location).toBe("Downloads-export");
    expect(await listed(chats)).toMatchInlineSnapshot(`
      [
        "gpt-a: What's a good name for a cat? (2)",
        "gpt-b: What's a good name for a cat? (2)",
        "gpt-remodel: Kitchen remodel (4)",
      ]
    `);
    expect(await readIds(chats, ["gpt-b", "gpt-remodel"]))
      .toMatchInlineSnapshot(`
      [
        "gpt-remodel",
        "gpt-b",
      ]
    `);
  });

  it("opens a Claude zip and names projects from projects.json", async () => {
    const zip = path.join(dir.path, "data-2026-10-01.zip");
    await writeZip(zip, {
      "users.json": JSON.stringify([{ uuid: "acct", full_name: "Person" }]),
      "projects.json": JSON.stringify([
        {
          uuid: "p1",
          name: "Backyard",
          docs: [{ content: "x".repeat(10_000) }],
        },
      ]),
      "conversations.json": JSON.stringify([
        claudeConversation({ project_uuid: "p1" }),
        claudeConversation({
          uuid: "claude-empty",
          name: "Empty",
          chat_messages: [],
        }),
      ]),
    });
    const { source, chats } = await openExport(zip);
    const { from, ...named } = source;
    expect(from).toEqual({ type: "export", path: zip });
    expect(named).toMatchInlineSnapshot(`
      {
        "kind": "claude-export",
        "location": "data-2026-10-01.zip",
        "name": "Claude",
        "site": "https://claude.ai",
      }
    `);
    expect(await listed(chats)).toMatchInlineSnapshot(`
      [
        "claude-garden: Garden planning (3)",
        "claude-empty: Empty (0, incidental)",
      ]
    `);
    const [garden] = await chats.list();
    expect(garden?.project).toBe("Backyard");
  });

  it("tells an export with no conversations apart by the files beside it", async () => {
    const zip = path.join(dir.path, "empty.zip");
    await writeZip(zip, { "users.json": "[]", "conversations.json": "[]" });
    const { source, chats } = await openExport(zip);
    expect(source.kind).toBe("claude-export");
    expect(await chats.list()).toEqual([]);
  });

  const notAnExport = "This file isn't a ChatGPT or Claude export.";

  it.each([
    [
      "a zip of something else",
      "photos.zip",
      async (file: string) => writeZip(file, { "IMG_0001.jpg": "" }),
    ],
    [
      "a file that is not a zip",
      "notes.zip",
      async (file: string) => fs.writeFile(file, "just text"),
    ],
    [
      "a folder with an unknown conversations file",
      "other",
      async (file: string) =>
        writeFolder(file, { "conversations.json": '[{"messages":[]}]' }),
    ],
  ])("rejects %s with a readable message", async (_, name, make) => {
    const file = path.join(dir.path, name);
    await make(file);
    await expect(openExport(file)).rejects.toThrow(notAnExport);
  });

  it("says a zip cut off partway might still be downloading", async () => {
    const zip = path.join(dir.path, "chatgpt.zip");
    await writeZip(zip, {
      "conversations.json": JSON.stringify([chatGptRemodel()]),
    });
    const bytes = await fs.readFile(zip);
    await fs.writeFile(zip, bytes.subarray(0, bytes.length / 2));
    await expect(openExport(zip)).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: This zip file couldn't be opened. It might be damaged, or it might not have finished downloading.]`,
    );
  });

  it("rejects a path that is not there", async () => {
    await expect(
      openExport(path.join(dir.path, "missing.zip")),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: That file couldn't be found.]`,
    );
  });
});

describe("jsonArrayObjects", () => {
  it("parses objects split anywhere across chunks, strings with brackets and escapes included", async () => {
    const json = JSON.stringify([
      { a: 'brace } and bracket ] and "quote" and \\ slash' },
      { b: "naïve 🍕 text", nested: [{ c: [1, 2] }] },
      7,
      { d: null },
    ]);
    const bytes = new TextEncoder().encode(json);
    async function* oneByteAtATime() {
      for (const byte of bytes) {
        yield new Uint8Array([byte]);
      }
    }
    const objects: unknown[] = [];
    for await (const object of jsonArrayObjects(oneByteAtATime())) {
      objects.push(object);
    }
    expect(objects).toMatchInlineSnapshot(`
      [
        {
          "a": "brace } and bracket ] and "quote" and \\ slash",
        },
        {
          "b": "naïve 🍕 text",
          "nested": [
            {
              "c": [
                1,
                2,
              ],
            },
          ],
        },
        {
          "d": null,
        },
      ]
    `);
  });
});
