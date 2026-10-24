import { InMemoryFs } from "just-bash";
import { okAsync } from "neverthrow";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { type ChatSource, type ImportedTranscript } from "../chat-import/model";
import { type OpenSource } from "../chat-import/run";
import { forgetChatFolders } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type ImportCommandContext, runImportCommand } from "./import";

let root = "";
let counter = 0;

beforeEach(() => {
  createMockChatConfig(
    ChatIdSchema.parse(`import-cmd-${Date.now()}-${(counter += 1)}`),
    { unplaced: true },
  );
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "import-command-")),
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
  title: string,
  extra: Partial<ImportedTranscript> = {},
): ImportedTranscript {
  const createdAt = new Date(Date.UTC(2025, 2, day, 9));
  return {
    createdAt,
    kind: "codex",
    messages: [
      { createdAt, role: "user", text: title },
      { createdAt, role: "assistant", text: "Sure." },
    ],
    sourceId,
    title,
    updatedAt: createdAt,
    ...extra,
  };
}

const TRANSCRIPTS = [
  chat("s1", 1, "Fix the login bug", { project: "~/code/site" }),
  chat("s2", 5, "Kitchen tile ideas"),
  chat("s3", 9, "Kitchen budget spreadsheet"),
  chat("s4", 10, "Explore the repo", { incidental: true }),
  ...Array.from({ length: 40 }, (_, index) =>
    chat(`bulk-${index}`, 12 + (index % 10), `Bulk chat ${index}`),
  ),
];

const open: OpenSource = () => {
  const chats: ChatSource = {
    kind: "codex",
    list: () =>
      Promise.resolve(
        TRANSCRIPTS.map(({ messages, ...candidate }) => ({
          ...candidate,
          messages: messages.length,
        })),
      ),
    async *read(ids) {
      for (const transcript of TRANSCRIPTS) {
        if (ids.includes(transcript.sourceId)) {
          yield transcript;
        }
      }
    },
  };
  return okAsync({
    chats,
    source: {
      from: { kind: "codex", type: "local" },
      kind: "codex",
      location: "~/.codex",
      name: "Codex",
      site: "openai.com",
    },
  });
};

const context: ImportCommandContext = { open, refusal: () => undefined };

async function run(...args: string[]) {
  const result = await runImportCommand(args, context, {
    cwd: "/work",
    fs: new InMemoryFs(),
    stdin: new Uint8Array(),
  } as never);
  return result.exitCode === 0
    ? result.stdout
    : `exit ${result.exitCode}: ${result.stderr}`;
}

describe("instrument import", () => {
  it("lists a search, newest first, then adds and marks what came in", async () => {
    expect(await run("list", "codex", "--search", "kitchen"))
      .toMatchInlineSnapshot(`
      "Codex: 2 chats match, newest first.
      s3  2025-03-09  2 msgs  Kitchen budget spreadsheet
      s2  2025-03-05  2 msgs  Kitchen tile ideas
      instrument import add codex <id>... brings chats in.
      "
    `);
    expect(await run("add", "codex", "s2", "s3")).toMatch(
      /^Imported 2 chats\.\n {2}s2 -> chat 2025-03-05-kitchen-tile-ideas-\w{4} {2}Kitchen tile ideas\n/,
    );
    expect(await run("list", "codex", "--search", "kitchen")).toMatch(
      /s3 {2}2025-03-09 {2}2 msgs {2}Kitchen budget spreadsheet {2}imported as chat 2025-03-09-kitchen-budget-\w{4}/,
    );
    expect(await run("add", "codex", "s2")).toMatchInlineSnapshot(`
      "Imported 0 chats, skipped 1 already here.
      "
    `);
  });

  it("caps a long list and says how to narrow it", async () => {
    const out = await run("list", "codex");
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toMatchInlineSnapshot(
      `"Codex: 43 chats, newest first. Showing 30; narrow with --search or --since, or raise --limit (up to 200)."`,
    );
    expect(lines.at(-2)).toMatchInlineSnapshot(
      `"1 run the agent made on its own left out; --incidental lists them."`,
    );
    expect(lines).toHaveLength(33);
  });

  it("adds everything a filter matches", async () => {
    expect(
      await run(
        "add",
        "codex",
        "--all-matching",
        "--since",
        "2025-03-05",
        "--search",
        "kitchen",
      ),
    ).toMatch(/^Imported 2 chats\./);
  });

  it("refuses an add with nothing to add, and a path it cannot read", async () => {
    expect(await run("add", "codex")).toMatchInlineSnapshot(`
      "exit 1: instrument import: add: which chats? Give their ids from instrument import list codex, or --all-matching with --search or --since.
      "
    `);
    expect(await run("list", "~/Downloads/export.zip")).toMatchInlineSnapshot(`
      "exit 1: instrument import: no file at ~/Downloads/export.zip. A source is claude-code, codex, cursor, or the path to a ChatGPT or Claude export.
      "
    `);
  });
});
