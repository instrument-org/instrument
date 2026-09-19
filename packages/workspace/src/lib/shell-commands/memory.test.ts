import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { listMemories, memoryDir } from "../memory/store";
import { Store } from "../store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createMemoryCommand } from "./memory";

vi.mock(import("../session-store-storage"));

const id = TaskIdSchema.parse("memory-command-test");
const sessionId = StoreId.newSessionId();

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-command-test-"));
  taskId = createMockTaskConfig(id);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  await Store.saveSession(
    {
      createdAt: new Date(),
      id: sessionId,
      title: "Roofer call",
      updatedAt: new Date(),
    },
    taskId,
  );
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

function run(args: string[], stdin = "") {
  return createMemoryCommand({ orchestratorTaskId: taskId, sessionId }).execute(
    args,
    createCommandContext({
      cwd: "/task",
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
      "Nothing remembered yet. memory save <name> keeps something.
      "
    `);
  });

  it("saves from a heredoc, naming the thread, and lists it", async () => {
    const saved = await run(
      ["save", "pacific-time"],
      "You are on Pacific time and mornings are best for calls.\n",
    );

    expect(saved.exitCode).toBe(0);
    expect(saved.stdout).toBe(
      'Saved "pacific-time": You are on Pacific time and mornings are best for calls.\n',
    );
    const [memory] = await listMemories(memoryDir());
    expect(memory?.from).toEqual({ sessionId, title: "Roofer call" });

    const listed = await run(["list"]);
    expect(listed.stdout).toMatch(
      /^1 memory, newest first \(memory show <name> for one whole\):\n {2}pacific-time {2}from "Roofer call" · \d{4}-\d{2}-\d{2}\n {4}You are on Pacific time and mornings are best for calls\.\n$/,
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
      'memory: no memory named "answers". memory list names them.\n',
    );
  });

  it("refuses a name that is not a slug, and a save with no text", async () => {
    const badName = await run(["save", "Pacific Time"], "fine");
    expect(badName.exitCode).toBe(1);
    expect(badName.stderr).toMatch(
      /^memory: save: "Pacific Time" is not a name a memory can have\./,
    );

    const noText = await run(["save", "pacific-time"]);
    expect(noText.exitCode).toBe(1);
    expect(noText.stderr).toMatch(/^memory: save: the memory is required/);
  });

  it("refuses a subcommand it does not have", async () => {
    const result = await run(["remember", "x"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^memory: unknown subcommand "remember"\./);
  });
});
