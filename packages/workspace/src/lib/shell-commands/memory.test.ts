import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import {
  createMockChatConfig,
  knowChat,
} from "../../test/helpers/mock-chat-config";
import { ChatWrites } from "../chat-writes";
import { listMemories, memoryDir } from "../memory/store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createMemoryCommand } from "./memory";

const id = ChatIdSchema.parse("memory-command-test");
const sessionId = StoreId.newSessionId();

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-command-test-"));
  chatId = createMockChatConfig(id);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  // The chat's records go in the folder this test's own chats folder gives it.
  knowChat(chatId);
  (
    await ChatWrites.saveSession(
      {
        createdAt: new Date(),
        id: sessionId,
        title: "Roofer call",
        updatedAt: new Date(),
      },
      chatId,
    )
  )._unsafeUnwrap();
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

function run(args: string[], stdin = "", role: "chat" | "task" = "chat") {
  return createMemoryCommand({
    chatId: ChatIdSchema.parse(chatId),
    role,
    sessionId,
  }).execute(
    args,
    createCommandContext({
      cwd: "/Users/sam/chat",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: stdin ? encodeUtf8ToBytes(stdin) : EMPTY_BYTES,
    }),
  );
}

describe("memory", () => {
  it("says there is nothing yet", async () => {
    const result = await run(["list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Nothing remembered yet. instrument memory save <name> keeps something.
      "
    `);
  });

  it("saves from a heredoc, naming the chat, and lists it", async () => {
    const saved = await run(
      ["save", "pacific-time"],
      "You are on Pacific time and mornings are best for calls.\n",
    );

    expect(saved.exitCode).toBe(0);
    expect(saved.stdout).toBe(
      'Saved "pacific-time": You are on Pacific time and mornings are best for calls.\n',
    );
    const [memory] = await listMemories(memoryDir());
    expect(memory?.chat).toBe(chatId);

    const listed = await run(["list"]);
    expect(listed.stdout).toMatch(
      /^1 memory, newest first \(instrument memory show <name> for one whole\):\n {2}pacific-time {2}from "Roofer call" · \d{4}-\d{2}-\d{2}\n {4}You are on Pacific time and mornings are best for calls\.\n$/,
    );
  });

  it("takes the memory as one argument when nothing is piped", async () => {
    const saved = await run([
      "save",
      "no-stevia",
      "No stevia: it gives you headaches.",
    ]);

    expect(saved.stdout).toBe(
      'Saved "no-stevia": No stevia: it gives you headaches.\n',
    );
  });

  it("refuses a memory with a key in it, and keeps nothing", async () => {
    const key = `sk-ant-api03-${"aB3dE5gH7j".repeat(9)}aBAA`;
    const refused = await run(
      ["save", "anthropic-key"],
      `Anthropic key for the newsletter script: ${key}`,
    );

    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toMatchInlineSnapshot(`
      "instrument memory: save: not saved, it has a secret in it (Anthropic key). A memory never keeps a key or password: save the fact without it. A service's key belongs to its app (\`instrument app new\`).
      "
    `);
    expect(await listMemories(memoryDir())).toEqual([]);
  });

  it("replaces under the same name, and says so", async () => {
    await run(["save", "sweetener"], "No stevia.");

    const corrected = await run(
      ["save", "sweetener"],
      "Stevia is fine; sucralose gives you headaches.",
    );

    expect(corrected.stdout).toBe(
      'Replaced "sweetener": Stevia is fine; sucralose gives you headaches.\n',
    );
    const listed = await listMemories(memoryDir());
    expect(listed.map((memory) => memory.text)).toEqual([
      "Stevia is fine; sucralose gives you headaches.",
    ]);
  });

  it("shows one whole and forgets it", async () => {
    await run(
      ["save", "answers"],
      "You want the short answer first.\n\nThe reasons after, when they matter.",
    );

    const shown = await run(["show", "answers"]);
    expect(shown.stdout).toMatch(
      /^answers {2}from "Roofer call" · \d{4}-\d{2}-\d{2}\n\nYou want the short answer first\.\n\nThe reasons after, when they matter\.\n$/,
    );

    const forgotten = await run(["forget", "answers"]);
    expect(forgotten.stdout).toBe(
      'Forgot "answers": You want the short answer first.\n',
    );
    expect(await listMemories(memoryDir())).toEqual([]);

    const again = await run(["forget", "answers"]);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toBe(
      'instrument memory: no memory named "answers". instrument memory list names them.\n',
    );
  });

  it("refuses a name that is not a slug, and a save with no text", async () => {
    const badName = await run(["save", "Pacific Time"], "fine");
    expect(badName.exitCode).toBe(1);
    expect(badName.stderr).toMatch(
      /^instrument memory: save: "Pacific Time" is not a name a memory can have\./,
    );

    const noText = await run(["save", "pacific-time"]);
    expect(noText.exitCode).toBe(1);
    expect(noText.stderr).toMatch(
      /^instrument memory: save: the memory is required/,
    );
  });

  // The memory folder sits inside the workspace, and the workspace inside the
  // user's files: a name that walks out of the folder is answered as no
  // memory, and the file it would have reached stays.
  it("neither shows nor forgets a file outside the memory folder", async () => {
    await fs.writeFile(path.join(root, "notes.md"), "Not a memory.\n");

    const shown = await run(["show", "../notes"]);
    expect(shown.exitCode).toBe(1);
    expect(shown.stderr).toBe(
      'instrument memory: no memory named "../notes". instrument memory list names them.\n',
    );

    const forgotten = await run(["forget", "../notes"]);
    expect(forgotten.exitCode).toBe(1);
    expect(await fs.readFile(path.join(root, "notes.md"), "utf8")).toBe(
      "Not a memory.\n",
    );
  });

  it("prints the memories as JSON with --json", async () => {
    await run(["save", "no-stevia"], "You never want stevia.\nIt tastes off.");

    const listed = await run(["list", "--json"]);
    expect(
      JSON.parse(listed.stdout.replaceAll(/\d{4}-\d{2}-\d{2}/g, "<day>")),
    ).toEqual([
      {
        day: "<day>",
        headline: "You never want stevia.",
        learned_in: "Roofer call",
        name: "no-stevia",
      },
    ]);
  });

  it("refuses words beside a memory on stdin, and keeps nothing", async () => {
    const result = await run(["save", "no-stevia", "extra"], "No stevia.");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument memory: unexpected argument "extra" beside the text on stdin. A word with a space in it needs quotes.
      "
    `);
    expect(await listMemories(memoryDir())).toEqual([]);
  });

  it("lists when run bare", async () => {
    const result = await run([]);

    expect(result.stdout).toContain("Nothing remembered yet.");
  });

  it("refuses a subcommand it does not have", async () => {
    const result = await run(["remember", "x"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      /^instrument memory: unknown subcommand "remember"\./,
    );
  });

  it("lets a task read memories and keep none", async () => {
    await run(["save", "no-stevia"], "You never want stevia.");

    const shown = await run(["show", "no-stevia"], "", "task");
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain("You never want stevia.");
    expect((await run(["list"], "", "task")).exitCode).toBe(0);

    const saved = await run(["save", "decaf"], "Only decaf.", "task");
    const forgot = await run(["forget", "no-stevia"], "", "task");
    expect(saved.exitCode).toBe(1);
    expect(saved.stderr).toMatchInlineSnapshot(`
      "instrument memory: only the chat saves and forgets memories. Say in your report what the chat should remember or forget.
      "
    `);
    expect(forgot.exitCode).toBe(1);
    expect((await run(["list"])).stdout).toContain("no-stevia");
    expect((await run(["list"])).stdout).not.toContain("decaf");
  });
});
