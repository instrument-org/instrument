import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cursorSource, cursorUserDir } from "./cursor";

/**
 * A synthetic Cursor store, shaped after published descriptions of its
 * format: no real Cursor install was read to build it.
 */

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-import-test-"));
});

afterEach(async () => {
  await fs.rm(home, { force: true, recursive: true });
});

const PLATFORM = "linux";

async function store(
  write: (put: (table: string, key: string, value: unknown) => void) => void,
) {
  const file = path.join(
    cursorUserDir(home, PLATFORM),
    "globalStorage",
    "state.vscdb",
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
  );
  db.exec(
    "CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
  );
  write((table, key, value) => {
    // Cursor writes some values as text and some as UTF-8 blobs.
    const json = JSON.stringify(value);
    db.prepare(`INSERT INTO ${table} (key, value) VALUES (?, ?)`).run(
      key,
      key.startsWith("bubbleId:") ? Buffer.from(json) : json,
    );
  });
  db.close();
}

const COMPOSER = "c0000000-0000-4000-8000-000000000001";
const LEGACY = "c0000000-0000-4000-8000-000000000002";
const EMPTY = "c0000000-0000-4000-8000-000000000003";

const bubbles = [
  {
    bubbleId: "b1",
    createdAt: "2026-04-01T08:00:00.000Z",
    text: "Draft a fence quote",
    type: 1,
  },
  {
    bubbleId: "b2",
    text: "",
    timingInfo: { clientStartTime: Date.parse("2026-04-01T08:01:00.000Z") },
    toolFormerData: { name: "read_file" },
    type: 2,
  },
  {
    bubbleId: "b3",
    text: "Forty feet of fence runs about $2,000.",
    timingInfo: { clientStartTime: Date.parse("2026-04-01T08:02:00.000Z") },
    type: 2,
  },
  {
    bubbleId: "b4",
    createdAt: "2026-04-01T08:03:00.000Z",
    images: [{ path: "/tmp/fence.png" }],
    text: "And with a gate?",
    type: 1,
  },
  {
    bubbleId: "b5",
    modelInfo: { modelName: "test-model-2" },
    text: "Add $300.",
    timingInfo: { clientStartTime: Date.parse("2026-04-01T08:04:00.000Z") },
    type: 2,
  },
];

async function fillStore() {
  await store((put) => {
    put("cursorDiskKV", `composerData:${COMPOSER}`, {
      _v: 3,
      composerId: COMPOSER,
      createdAt: Date.parse("2026-04-01T08:00:00.000Z"),
      fullConversationHeadersOnly: bubbles.map(({ bubbleId, type }) => ({
        bubbleId,
        type,
      })),
      lastUpdatedAt: Date.parse("2026-04-01T08:04:00.000Z"),
      modelConfig: { modelName: "test-model-1" },
      name: "",
    });
    for (const bubble of bubbles) {
      put("cursorDiskKV", `bubbleId:${COMPOSER}:${bubble.bubbleId}`, bubble);
    }
    put("cursorDiskKV", `composerData:${LEGACY}`, {
      composerId: LEGACY,
      conversation: [
        { bubbleId: "l1", text: "Old question", type: 1 },
        { bubbleId: "l2", text: "Old answer", type: 2 },
      ],
      createdAt: Date.parse("2025-01-01T00:00:00.000Z"),
      name: "Legacy chat",
    });
    put("cursorDiskKV", `composerData:${EMPTY}`, {
      composerId: EMPTY,
      createdAt: Date.parse("2026-04-02T00:00:00.000Z"),
      fullConversationHeadersOnly: [],
    });
    put("cursorDiskKV", "composerData:broken", "not an object");
    put("ItemTable", "composer.composerHeaders", {
      allComposers: [
        {
          composerId: COMPOSER,
          workspaceIdentifier: {
            id: "abc",
            uri: { fsPath: path.join(home, "yard") },
          },
        },
      ],
    });
  });
}

describe("cursorSource", () => {
  it("lists chats from their headers, newest first", async () => {
    await fillStore();

    expect(
      await cursorSource({ homeDir: home, platform: PLATFORM }).list(),
    ).toMatchInlineSnapshot(`
      [
        {
          "createdAt": 2026-04-01T08:00:00.000Z,
          "kind": "cursor",
          "messages": 4,
          "preview": "Draft a fence quote",
          "project": "~/yard",
          "sourceId": "c0000000-0000-4000-8000-000000000001",
          "title": "Draft a fence quote",
          "updatedAt": 2026-04-01T08:04:00.000Z,
        },
        {
          "createdAt": 2025-01-01T00:00:00.000Z,
          "kind": "cursor",
          "messages": 2,
          "preview": "Old question",
          "sourceId": "c0000000-0000-4000-8000-000000000002",
          "title": "Legacy chat",
          "updatedAt": 2025-01-01T00:00:00.000Z,
        },
      ]
    `);
  });

  it("reads each message in full, one reply per turn", async () => {
    await fillStore();
    const read = [];
    for await (const transcript of cursorSource({
      homeDir: home,
      platform: PLATFORM,
    }).read([COMPOSER, "missing"])) {
      read.push(transcript);
    }

    expect(
      read.map((transcript) => transcript.messages),
    ).toMatchInlineSnapshot(`
      [
        [
          {
            "createdAt": 2026-04-01T08:00:00.000Z,
            "role": "user",
            "text": "Draft a fence quote",
          },
          {
            "createdAt": 2026-04-01T08:01:00.000Z,
            "model": "test-model-1",
            "omitted": {
              "toolCalls": {
                "read_file": 1,
              },
            },
            "role": "assistant",
            "text": "Forty feet of fence runs about $2,000.",
          },
          {
            "createdAt": 2026-04-01T08:03:00.000Z,
            "omitted": {
              "attachments": 1,
            },
            "role": "user",
            "text": "And with a gate?",
          },
          {
            "createdAt": 2026-04-01T08:04:00.000Z,
            "model": "test-model-2",
            "role": "assistant",
            "text": "Add $300.",
          },
        ],
      ]
    `);
  });

  it("finds a chat's folder from a workspace that predates the central index", async () => {
    await store((put) => {
      put("cursorDiskKV", `composerData:${LEGACY}`, {
        composerId: LEGACY,
        conversation: [
          { text: "Q", type: 1 },
          { text: "A", type: 2 },
        ],
        createdAt: Date.parse("2025-01-01T00:00:00.000Z"),
      });
    });
    const workspace = path.join(
      cursorUserDir(home, PLATFORM),
      "workspaceStorage",
      "hash1",
    );
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(
      path.join(workspace, "workspace.json"),
      JSON.stringify({ folder: pathToFileURL(path.join(home, "porch")).href }),
    );
    const db = new DatabaseSync(path.join(workspace, "state.vscdb"));
    db.exec("CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB)");
    db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
      "composer.composerData",
      JSON.stringify({ allComposers: [{ composerId: LEGACY }] }),
    );
    db.close();

    const [listed] = await cursorSource({
      homeDir: home,
      platform: PLATFORM,
    }).list();

    expect([listed?.project, listed?.title]).toEqual(["~/porch", "Q"]);
  });

  it("lists nothing when Cursor is not installed", async () => {
    expect(
      await cursorSource({ homeDir: home, platform: PLATFORM }).list(),
    ).toEqual([]);
  });
});
