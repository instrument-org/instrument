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

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { createMemoryAppsConfig } from "../apps/memory-config";
import { loadApp } from "../apps/store";
import { initializeTask } from "../initialize-task";
import { taskDir } from "../task-dir-utils";
import { setTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";
import { runApp as run, type TaskCommandContext } from "./task";
import { ChatIdSchema } from "../../schemas/chat-id";

// The chat the tasks were started in: a record of its own under `chats/`.
const CHAT_SESSION = StoreId.SessionSchema.parse(
  "ses_01M3AX9RF3C2E9RTATMB602W0B",
);
// A chat and a task of their own per test: a store handle is kept per record
// id, and each test's workspace is a folder of its own.
let counter = 0;
let CHAT_ID = ChatIdSchema.parse("2026-09-26-conversation");
let CHILD_ID = TaskIdSchema.parse("file-the-issue");

let context: TaskCommandContext;

// Whether the child's turn is running, and what was handed to its session.
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
      },
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  // Only `ok` and `value` are read; the Result class behind the real return
  // is not a dependency of this package.
  fetchModel: () =>
    Promise.resolve({ ok: true, value: createMockAIGatewayModel() } as never),
}));

/** The text of each message handed to the task's session, and whether it interrupted. */
function delivered() {
  return sent.events.flatMap((event) =>
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "addMessage" &&
    "value" in event &&
    typeof event.value === "object" &&
    event.value !== null &&
    "message" in event.value &&
    typeof event.value.message === "object" &&
    event.value.message !== null &&
    "parts" in event.value.message &&
    Array.isArray(event.value.message.parts)
      ? [
          event.value.message.parts
            .flatMap((part: unknown) =>
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "text" &&
              "text" in part &&
              typeof part.text === "string"
                ? [part.text]
                : [],
            )
            .join("\n"),
        ]
      : [],
  );
}

/** The subcommand, with what it is for on stdin when a test gives it. */
function runApp(
  args: string[],
  commandContext: TaskCommandContext,
  message = "",
) {
  return run(args, commandContext, encodeUtf8ToBytes(message));
}

let rootDir: string;
// One store for the whole test, so a connection set through the config the
// command reads is the same one a later `useWorkspace` hands back.
let appsConfig: ReturnType<typeof createMemoryAppsConfig>;
const originalApps = getWorkspaceConfig().apps;

/** An app in the workspace, connected on the manifest it currently has. */
async function connectedApp(slug: string) {
  const result = await createAppCommand({ taskId: CHAT_ID }).execute(
    ["new", slug, "--name", "Linear", "--mcp", "https://mcp.example.com/sse"],
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr);
  }
  const loaded = await loadApp(getWorkspaceConfig().appsDir, slug);
  if (loaded.isErr()) {
    throw new Error(loaded.error.message);
  }
  await getWorkspaceConfig().apps.connections.set(slug, {
    manifestHash: loaded.value.manifestHash,
    status: "connected",
    updatedAt: Date.now(),
  });
}

/** The apps a task may reach, as its settings hold them. */
async function heldBy(taskId: TaskId) {
  const settings = await getTaskSettings(taskDir(taskId));
  return settings?.apps;
}

/**
 * Points the workspace at this test's directories. `createMockTaskConfigForDir`
 * replaces the whole config, so anything set before it is gone and every caller
 * of it has to follow with this.
 */
function useWorkspace(taskId: string) {
  createMockTaskConfigForDir(path.join(rootDir, "tasks", taskId), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    // A chat's record goes under the root, kept apart from the folders
    // the test attaches.
    apps: appsConfig,
    appsDir: AbsolutePathSchema.parse(path.join(rootDir, "apps")),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  chatFor(CHAT_SESSION, CHAT_ID);
}

beforeEach(async () => {
  counter += 1;
  CHAT_ID = ChatIdSchema.parse(`2026-09-26-conversation-${counter}`);
  CHILD_ID = TaskIdSchema.parse(`file-the-issue-${counter}`);
  context = { chatId: CHAT_ID, remainingYieldMs: () => 0 };
  working.value = false;
  sent.events = [];
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-app-"));
  appsConfig = createMemoryAppsConfig();
  useWorkspace(CHILD_ID);
  await setTaskState(taskDir(CHAT_ID), {
    selectedModelURI:
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
  });
  const created = await initializeTask(
    {
      chatId: CHAT_ID,
      initialSettings: { apps: [], name: "File the issue" },
      taskId: CHILD_ID,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (created.isErr()) {
    throw created.error;
  }
});

afterEach(async () => {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps: originalApps });
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("task app", () => {
  it("hands a connected app to a task that started without one", async () => {
    await connectedApp("linear");

    const result = await runApp([CHILD_ID, "--add", "linear"], context);

    expect(result.stdout).toContain(`${CHILD_ID} can now reach linear`);
    expect(await heldBy(CHILD_ID)).toEqual(["linear"]);
  });

  it("takes an app back", async () => {
    await connectedApp("linear");
    await runApp([CHILD_ID, "--add", "linear"], context);

    const result = await runApp([CHILD_ID, "--remove", "linear"], context);

    expect(result.stdout).toContain(`Took linear back from ${CHILD_ID}`);
    expect(await heldBy(CHILD_ID)).toEqual([]);
  });

  it("does not hand the same app over twice", async () => {
    await connectedApp("linear");
    await runApp([CHILD_ID, "--add", "linear"], context);
    await runApp([CHILD_ID, "--add", "linear"], context);

    expect(await heldBy(CHILD_ID)).toEqual(["linear"]);
  });

  it("refuses an app that is not connected", async () => {
    await expect(
      runApp([CHILD_ID, "--add", "linear"], context),
    ).rejects.toThrow(/--app linear/);
    expect(await heldBy(CHILD_ID)).toEqual([]);
  });

  it("refuses to remove an app the task does not have", async () => {
    await expect(
      runApp([CHILD_ID, "--remove", "notion"], context),
    ).rejects.toThrow(/does not have "notion"/);
  });

  it("leaves the task's apps alone when one slug on the line is refused", async () => {
    await connectedApp("linear");
    await runApp([CHILD_ID, "--add", "linear"], context);

    await expect(
      runApp([CHILD_ID, "--add", "notion", "--remove", "linear"], context),
    ).rejects.toThrow(/--app notion/);

    expect(await heldBy(CHILD_ID)).toEqual(["linear"]);
  });

  it("needs one of --add, --remove, or --none", async () => {
    await expect(runApp([CHILD_ID], context)).rejects.toThrow(
      /--add, --remove, or --none is required/,
    );
  });

  // A grant tells the task itself, so no `send` has to follow it.
  it("starts an idle task on the app it was handed, with what it is for", async () => {
    await connectedApp("linear");

    const result = await runApp(
      [CHILD_ID, "--add", "linear"],
      context,
      "File the bug you wrote up as a Linear issue in the Web team.",
    );

    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "<id> can now reach linear.
      Sent to <id>, which carries on with it now; you will be told when it finishes.
      "
    `);
    expect(delivered()).toMatchInlineSnapshot(`
      [
        "You were handed the connected app linear.

      File the bug you wrote up as a Linear issue in the Web team.",
      ]
    `);
  });

  it("takes every app back with --none, telling a working task", async () => {
    await connectedApp("linear");
    await runApp([CHILD_ID, "--add", "linear"], context);
    working.value = true;
    sent.events = [];

    const result = await runApp([CHILD_ID, "--none"], context);

    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "Took linear back from <id>.
      Sent to <id>, which is busy and hears this at its next step; you will be told when its turn finishes.
      "
    `);
    expect(delivered()).toMatchInlineSnapshot(`
      [
        "The app linear was taken back from you.",
      ]
    `);
    expect(await heldBy(CHILD_ID)).toEqual([]);
  });

  it("refuses a task a person made, which already reaches every app", async () => {
    const personMade = TaskIdSchema.parse("someones-own-task");
    useWorkspace(personMade);
    const created = await initializeTask(
      {
        chatId: CHAT_ID,
        initialSettings: { name: "Theirs" },
        taskId: personMade,
        workspaceConfig: getWorkspaceConfig(),
      },
      {},
    );
    if (created.isErr()) {
      throw created.error;
    }
    await connectedApp("linear");

    await expect(
      runApp([personMade, "--add", "linear"], context),
    ).rejects.toThrow(/already reaches every connected app/);
  });

  it("refuses a task another chat started", async () => {
    await expect(
      runApp([CHILD_ID, "--add", "linear"], {
        ...context,
        chatId: ChatIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(`"${CHILD_ID}" was started in another chat`);
  });
});
