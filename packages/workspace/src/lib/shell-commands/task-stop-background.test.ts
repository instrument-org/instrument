import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import {
  killSessionBackgroundProcesses,
  listTaskBackgroundProcesses,
  promoteBackgroundProcess,
  startBackgroundRun,
} from "../background-processes";
import { initializeChat, initializeTask } from "../initialize-task";
import { Store } from "../store";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type TaskCommandContext } from "./task/context";
import { logSubcommand } from "./task/log";
import { stopSubcommand } from "./task/stop";
import { ChatIdSchema } from "../../schemas/chat-id";
import { subcommandRunner } from "../../test/helpers/run-subcommand";

const runLog = subcommandRunner(logSubcommand, "task log");
const runStop = subcommandRunner(stopSubcommand, "task stop");

// Whether the child's turn is running; idle unless a test says otherwise.
const working = vi.hoisted(() => ({ value: false }));
const sent = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock(import("../chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: () => working.value,
}));

vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      send: (event: unknown) => {
        sent.events.push(event);
        // A stopped session goes idle.
        working.value = false;
      },
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

// The chat the tasks were started in, a fresh one per test: a store handle is
// kept per record id, and each test's workspace is a folder of its own.
let counter = 0;
let CHAT_SESSION = StoreId.newSessionId();
let CHAT_ID = ChatIdSchema.parse("2026-09-26-conversation");
const CHILD_ID = TaskIdSchema.parse("find-the-vault");

let context: TaskCommandContext;

let rootDir: string;
let sessionId: StoreId.Session;

beforeEach(async () => {
  counter += 1;
  working.value = false;
  sent.events = [];
  CHAT_SESSION = StoreId.newSessionId();
  CHAT_ID = ChatIdSchema.parse(`2026-09-26-conversation-${counter}`);
  context = { chatId: CHAT_ID, remainingYieldMs: () => 0 };
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-stop-background-"));
  createMockTaskConfigForDir(path.join(rootDir, "tasks", CHILD_ID), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    // A chat's record goes under the root, kept apart from the folders
    // the test attaches.
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  const chat = await initializeChat({
    chatId: CHAT_ID,
    initialSettings: { name: "Instrument" },
    sessionId: CHAT_SESSION,
    workspaceConfig: getWorkspaceConfig(),
  });
  if (chat.isErr()) {
    throw chat.error;
  }
  const created = await initializeTask(
    {
      chatId: CHAT_ID,
      initialSettings: {
        name: "Find the vault",
      },
      taskId: CHILD_ID,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (created.isErr()) {
    throw created.error;
  }
  sessionId = StoreId.newSessionId();
});

afterEach(async () => {
  await killSessionBackgroundProcesses(sessionId);
  await fs.rm(rootDir, { force: true, recursive: true });
});

/**
 * A process the child left behind: a run that streams nothing and ends only
 * when its signal aborts, the way a killed subprocess settles.
 */
function leave(command: string) {
  const handle = startBackgroundRun({
    callerSignal: new AbortController().signal,
    command,
    run: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      }),
    taskId: CHILD_ID,
  });
  const promoted = promoteBackgroundProcess({
    handle,
    sessionId,
    taskId: CHILD_ID,
  });
  if ("error" in promoted) {
    throw new Error(promoted.error);
  }
  return promoted.info;
}

/** Output with the ids that differ from run to run written as placeholders. */
function shown(stdout: string) {
  return stdout.replaceAll(CHILD_ID, "<id>").replaceAll(/bg_\d+/g, "bg_N");
}

function stillRunning() {
  return listTaskBackgroundProcesses(CHILD_ID)
    .filter((process) => process.status === "running")
    .map((process) => process.id);
}

describe("task stop, for what a task left running", () => {
  it("stops the one process named and leaves the rest", async () => {
    const scan = leave("rg -l vault /mnt/Home | head -200");
    const server = leave("node work/server.js");

    const result = await runStop([CHILD_ID, scan.id], context);

    expect(shown(result.stdout)).toMatchInlineSnapshot(`
      "Stopped bg_N \`rg -l vault /mnt/Home | head -200\` (1 second).
      "
    `);
    expect(stillRunning()).toEqual([server.id]);
  });

  it("stops everything with --all", async () => {
    leave("rg -l vault /mnt/Home | head -200");
    leave("node work/server.js");

    const result = await runStop([CHILD_ID, "--all"], context);

    expect(shown(result.stdout)).toMatchInlineSnapshot(`
      "<id> is not running.
      Stopped bg_N \`rg -l vault /mnt/Home | head -200\` (1 second).
      Stopped bg_N \`node work/server.js\` (1 second).
      "
    `);
    expect(stillRunning()).toEqual([]);
  });

  it("ends the turn too with --all", async () => {
    working.value = true;
    leave("node work/server.js");

    const result = await runStop([CHILD_ID, "--all"], context);

    expect(shown(result.stdout)).toMatchInlineSnapshot(`
      "Stopped <id>. Its turn ended where it was; \`task send\` gives it the next thing to do.
      Stopped bg_N \`node work/server.js\` (1 second).
      "
    `);
    expect(sent.events).toEqual([
      { type: "stopSessions", value: { id: CHILD_ID } },
    ]);
    expect(stillRunning()).toEqual([]);
  });

  it("ends a working turn on a bare stop and names what it left running", async () => {
    working.value = true;
    const server = leave("node work/server.js");

    const result = await runStop([CHILD_ID], context);

    expect(shown(result.stdout)).toMatchInlineSnapshot(`
      "Stopped <id>. Its turn ended where it was; \`task send\` gives it the next thing to do.
      It left running in the background: bg_N \`node work/server.js\` (1 second). \`task stop <id> <bg id>\` stops one, \`task stop <id> --all\` every one.
      "
    `);
    expect(stillRunning()).toEqual([server.id]);
  });

  // A bare stop is for the turn; a server the user is looking at outlives it,
  // so an idle task's processes are named with the command that stops them.
  it("leaves the background alone on a bare stop, and says how to stop it", async () => {
    const server = leave("node work/server.js");

    const result = await runStop([CHILD_ID], context);

    expect(shown(result.stdout)).toMatchInlineSnapshot(`
      "<id> is not running.
      It left running in the background: bg_N \`node work/server.js\` (1 second). \`task stop <id> <bg id>\` stops one, \`task stop <id> --all\` every one.
      "
    `);
    expect(stillRunning()).toEqual([server.id]);
  });

  it("says so when nothing is running", async () => {
    const bare = await runStop([CHILD_ID], context);
    expect(shown(bare.stdout)).toMatchInlineSnapshot(`
      "<id> is not running.
      "
    `);
    const all = await runStop([CHILD_ID, "--all"], context);
    expect(shown(all.stdout)).toMatchInlineSnapshot(`
      "<id> is not running.
      <id> has nothing running in the background.
      "
    `);
  });

  it("names what is running when the id is not there", async () => {
    const server = leave("node work/server.js");
    await expect(runStop([CHILD_ID, "bg_99"], context)).rejects.toThrow(
      `no bg_99 running in ${CHILD_ID}. In the background: ${server.id} \`node work/server.js\` (1 second).`,
    );
    expect(stillRunning()).toEqual([server.id]);
  });

  it("takes a process id or --all, not both", async () => {
    await expect(runStop([CHILD_ID, "bg_1", "--all"], context)).rejects.toThrow(
      /a process id or --all, not both/,
    );
  });

  it("refuses a task another chat started", async () => {
    leave("node work/server.js");
    await expect(
      runStop([CHILD_ID, "--all"], {
        ...context,
        chatId: ChatIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(/"find-the-vault" was started in another chat/);
  });

  // A task started in another chat reports there, so steering it from here
  // would move a conversation the user is not having; reading it stays open.
  it("refuses to act on a task another chat started, naming the chat, and still reads it", async () => {
    const theirs = CHAT_SESSION;
    const saved = await Store.saveSession(
      {
        createdAt: new Date(),
        id: theirs,
        title: "Vault hunt",
      },
      CHAT_ID,
    );
    if (saved.isErr()) {
      throw saved.error;
    }
    const server = leave("node work/server.js");
    const elsewhere = chatFor();
    const here = { ...context, chatId: elsewhere };
    await expect(runStop([CHILD_ID, "--all"], here)).rejects.toThrow(
      `"find-the-vault" was started in another chat ("Vault hunt"), and is that chat's to steer: you can read it (\`task show\`, \`task log\`) but not send to it, stop it, or change it.`,
    );
    expect(stillRunning()).toEqual([server.id]);
    await expect(runLog([CHILD_ID], here)).resolves.toBeDefined();
    // Its own chat still steers it.
    await expect(runStop([CHILD_ID, "--all"], context)).resolves.toBeDefined();
  });

  // An id guessed from a task's title gets most of the words right, and the
  // miss cost a turn and two more minutes of the process it meant to stop.
  it("offers the nearest of its own tasks for a mistyped id", async () => {
    await expect(runStop(["find-the-vaults"], context)).rejects.toThrow(
      'no task "find-the-vaults" of yours. Did you mean "find-the-vault"? See `task list`.',
    );
    await expect(runStop(["draft-a-brief"], context)).rejects.toThrow(
      'no task "draft-a-brief" of yours. See `task list`.',
    );
  });
});
