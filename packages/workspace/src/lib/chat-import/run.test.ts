import { okAsync } from "neverthrow";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { forgetChatFolders } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  type ChatSource,
  type ImportedTranscript,
  type ImportProgress,
} from "./model";
import { listCandidates, type OpenSource, runImport } from "./run";

let root = "";
let counter = 0;

beforeEach(() => {
  createMockChatConfig(
    ChatIdSchema.parse(`import-run-${Date.now()}-${(counter += 1)}`),
    { unplaced: true },
  );
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "chat-import-run-")),
  );
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    legacyTasksDir: AbsolutePathSchema.parse(path.join(root, "tasks")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  forgetChatFolders();
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

function chat(
  sourceId: string,
  day: number,
  words = sourceId,
): ImportedTranscript {
  const createdAt = new Date(Date.UTC(2025, 0, day, 9));
  return {
    createdAt,
    kind: "claude-code",
    messages: [
      { createdAt, role: "user", text: words },
      {
        createdAt: new Date(createdAt.getTime() + 60_000),
        role: "assistant",
        text: "Done.",
      },
    ],
    sourceId,
    title: words,
    updatedAt: new Date(createdAt.getTime() + 60_000),
  };
}

/** A source over transcripts in memory, whose reading fails after `failAfter` chats. */
function fakeSource(
  transcripts: ImportedTranscript[],
  { failAfter }: { failAfter?: number } = {},
): OpenSource {
  const chats: ChatSource = {
    kind: "claude-code",
    list: () =>
      Promise.resolve(
        transcripts.map(({ messages, ...candidate }) => ({
          ...candidate,
          messages: messages.length,
        })),
      ),
    async *read(ids) {
      let read = 0;
      for (const transcript of transcripts) {
        if (ids.includes(transcript.sourceId)) {
          if (failAfter !== undefined && read >= failAfter) {
            throw new Error("The session log ended partway.");
          }
          read += 1;
          yield transcript;
        }
      }
    },
  };
  return () =>
    okAsync({
      chats,
      source: {
        from: { kind: "claude-code", type: "local" },
        kind: "claude-code",
        location: "~/.claude",
        name: "Claude Code",
        site: "claude.com",
      },
    });
}

describe("runImport", () => {
  it("imports, skips what is here, and fails what the source lacks", async () => {
    const open = fakeSource([chat("a", 1), chat("b", 2), chat("c", 3)]);
    const progress: ImportProgress[] = [];
    const onProgress = (each: ImportProgress) => progress.push(each);

    const first = (
      await runImport(
        { from: { kind: "claude-code", type: "local" }, sourceIds: ["a", "b"] },
        { onProgress, open },
      )
    )._unsafeUnwrap();
    expect(first.imported.map(({ sourceId }) => sourceId).toSorted()).toEqual([
      "a",
      "b",
    ]);
    expect(progress.map(({ done, total }) => `${done}/${total}`)).toEqual([
      "1/2",
      "2/2",
    ]);

    progress.length = 0;
    const second = (
      await runImport(
        {
          from: { kind: "claude-code", type: "local" },
          sourceIds: ["a", "c", "gone"],
        },
        { onProgress, open },
      )
    )._unsafeUnwrap();
    expect({
      failed: second.failed,
      imported: second.imported.map(({ sourceId }) => sourceId),
      skipped: second.skipped.map(({ chatId, sourceId }) => ({
        sameChat:
          chatId ===
          first.imported.find((each) => each.sourceId === "a")?.chatId,
        sourceId,
      })),
    }).toMatchInlineSnapshot(`
      {
        "failed": [
          {
            "error": "The source no longer has this chat.",
            "sourceId": "gone",
          },
        ],
        "imported": [
          "c",
        ],
        "skipped": [
          {
            "sameChat": true,
            "sourceId": "a",
          },
        ],
      }
    `);
    expect(progress).toHaveLength(2);
  });

  it("fails what is left unread when reading the source fails", async () => {
    const open = fakeSource([chat("a", 1), chat("b", 2)], { failAfter: 1 });
    const result = (
      await runImport(
        { from: { kind: "claude-code", type: "local" }, sourceIds: ["a", "b"] },
        { onProgress: () => undefined, open },
      )
    )._unsafeUnwrap();
    expect({
      failed: result.failed,
      imported: result.imported.map(({ sourceId }) => sourceId),
    }).toMatchInlineSnapshot(`
      {
        "failed": [
          {
            "error": "The session log ended partway.",
            "sourceId": "b",
          },
        ],
        "imported": [
          "a",
        ],
      }
    `);
  });
});

describe("listCandidates", () => {
  it("lists newest first, marking what is already here", async () => {
    const open = fakeSource([chat("a", 1), chat("b", 3), chat("c", 2)]);
    const run = (
      await runImport(
        { from: { kind: "claude-code", type: "local" }, sourceIds: ["c"] },
        { onProgress: () => undefined, open },
      )
    )._unsafeUnwrap();
    const listed = (
      await listCandidates({ kind: "claude-code", type: "local" }, open)
    )._unsafeUnwrap();
    expect(
      listed.candidates.map(({ imported, sourceId }) => [
        sourceId,
        imported === run.imported[0]?.chatId,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "b",
          false,
        ],
        [
          "c",
          true,
        ],
        [
          "a",
          false,
        ],
      ]
    `);
  });
});
