import { encodeUtf8ToBytes } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { attachFolder } from "../attach-folder";
import { initializeTask } from "../initialize-task";
import { outputFolderPath } from "../orchestrator/output-folder";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { runFolder as run, type TaskCommandContext } from "./task";

// The chat the tasks were started in: a record of its own under `chats/`.
const ORCHESTRATOR_SESSION = StoreId.SessionSchema.parse(
  "ses_01M3AX9RF3C2E9RTATMB602W0B",
);
// A chat and a task of their own per test: a store handle is kept per record
// id, and each test's workspace is a folder of its own.
let counter = 0;
let ORCHESTRATOR_ID = TaskIdSchema.parse("2026-09-26-conversation");
let CHILD_ID = TaskIdSchema.parse("find-the-vault");

let context: TaskCommandContext;

// Whether the child's turn is running, and what was handed to its session.
const working = vi.hoisted(() => ({ value: false }));
const sent = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock(import("../orchestrator/activity"), async (importOriginal) => ({
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
function runFolder(
  args: string[],
  commandContext: TaskCommandContext,
  message = "",
) {
  return run(args, commandContext, encodeUtf8ToBytes(message));
}

let rootDir: string;
let home: string;

/** The folders a task holds, by path, with the access each carries. */
async function heldBy(taskId: TaskId) {
  const state = await getTaskState(taskDir(taskId));
  return Object.fromEntries(
    Object.values(state.attachedFolders ?? {}).map((folder) => [
      folder.path,
      folder.access,
    ]),
  );
}

beforeEach(async () => {
  counter += 1;
  ORCHESTRATOR_ID = TaskIdSchema.parse(`2026-09-26-conversation-${counter}`);
  CHILD_ID = TaskIdSchema.parse(`find-the-vault-${counter}`);
  context = { orchestratorTaskId: ORCHESTRATOR_ID, remainingYieldMs: () => 0 };
  working.value = false;
  sent.events = [];
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-folder-"));
  home = path.join(rootDir, "home");
  await fs.mkdir(path.join(home, "Downloads"), { recursive: true });
  await fs.mkdir(path.join(home, "Desktop"), { recursive: true });
  for (const id of [CHILD_ID]) {
    createMockTaskConfigForDir(path.join(rootDir, "tasks", id));
  }
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    // A chat's record goes under the root, kept apart from the folders
    // the test attaches.
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  for (const [id, settings] of [
    [
      ORCHESTRATOR_ID,
      {
        chatSessionId: ORCHESTRATOR_SESSION,
        kind: "orchestrator" as const,
        name: "Conversation",
      },
    ],
    [CHILD_ID, { name: "Find the vault", parentTaskId: ORCHESTRATOR_ID }],
  ] as const) {
    const created = await initializeTask(
      {
        initialSettings: settings,
        taskId: id,
        workspaceConfig: getWorkspaceConfig(),
      },
      {},
    );
    if (created.isErr()) {
      throw created.error;
    }
  }
  await setTaskState(taskDir(ORCHESTRATOR_ID), {
    selectedModelURI:
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
  });
  // The conversation holds the whole home folder, read and write, which is what
  // it can hand a task a folder inside of.
  await attachFolder({
    access: "read-write",
    path: home,
    taskId: ORCHESTRATOR_ID,
  });
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("task folder", () => {
  it("hands a running task a folder it did not start with", async () => {
    const result = await runFolder(
      [CHILD_ID, "--add", "/mnt/home/Downloads:rw"],
      context,
    );

    expect(result.stdout).toContain(`${CHILD_ID} now has`);
    expect(result.stdout).toContain("(read-write)");
    expect(await heldBy(CHILD_ID)).toMatchObject({
      [path.join(home, "Downloads")]: "read-write",
    });
  });

  it("narrows the grant to read-only when the spec says so", async () => {
    await runFolder([CHILD_ID, "--add", "/mnt/home/Downloads:ro"], context);

    expect(await heldBy(CHILD_ID)).toMatchObject({
      [path.join(home, "Downloads")]: "read-only",
    });
  });

  it("re-grants a folder the task already has rather than mounting it twice", async () => {
    await runFolder([CHILD_ID, "--add", "/mnt/home/Downloads:ro"], context);
    await runFolder([CHILD_ID, "--add", "/mnt/home/Downloads:rw"], context);

    const state = await getTaskState(taskDir(CHILD_ID));
    const held = Object.values(state.attachedFolders ?? {}).filter(
      (folder) => folder.path === path.join(home, "Downloads"),
    );
    expect(held).toHaveLength(1);
    expect(held[0]?.access).toBe("read-write");
  });

  it("takes a folder back", async () => {
    await runFolder([CHILD_ID, "--add", "/mnt/home/Downloads:rw"], context);

    const result = await runFolder(
      [CHILD_ID, "--remove", "/mnt/home/Downloads"],
      context,
    );

    expect(result.stdout).toContain(`back from ${CHILD_ID}`);
    expect(await heldBy(CHILD_ID)).not.toHaveProperty(
      path.join(home, "Downloads"),
    );
  });

  it("adds and removes in one call, taking away first", async () => {
    await runFolder([CHILD_ID, "--add", "/mnt/home/Downloads:rw"], context);

    await runFolder(
      [
        CHILD_ID,
        "--remove",
        "/mnt/home/Downloads",
        "--add",
        "/mnt/home/Desktop:rw",
      ],
      context,
    );

    const held = await heldBy(CHILD_ID);
    expect(held).toHaveProperty(path.join(home, "Desktop"));
    expect(held).not.toHaveProperty(path.join(home, "Downloads"));
  });

  it("refuses a folder this conversation does not hold", async () => {
    await expect(
      runFolder([CHILD_ID, "--add", "/mnt/elsewhere"], context),
    ).rejects.toThrow(/no folder "elsewhere" in this conversation/);
  });

  it("refuses a folder that is not on disk", async () => {
    await expect(
      runFolder([CHILD_ID, "--add", "/mnt/home/Nowhere"], context),
    ).rejects.toThrow(/no folder at/);
  });

  it("refuses to remove a folder the task does not have", async () => {
    await expect(
      runFolder([CHILD_ID, "--remove", "/mnt/home/Downloads"], context),
    ).rejects.toThrow(/has no folder/);
  });

  it("leaves the task's folders alone when one spec on the line is refused", async () => {
    await runFolder([CHILD_ID, "--add", "/mnt/home/Downloads:rw"], context);
    const before = await heldBy(CHILD_ID);

    await expect(
      runFolder(
        [
          CHILD_ID,
          "--remove",
          "/mnt/home/Downloads",
          "--add",
          "/mnt/home/Nowhere",
        ],
        context,
      ),
    ).rejects.toThrow(/no folder at/);

    expect(await heldBy(CHILD_ID)).toEqual(before);
  });

  it("needs one of --add, --remove, or --none", async () => {
    await expect(runFolder([CHILD_ID], context)).rejects.toThrow(
      /--add, --remove, or --none is required/,
    );
  });

  it("refuses a task another chat started", async () => {
    await expect(
      runFolder([CHILD_ID, "--add", "/mnt/home/Downloads:rw"], {
        ...context,
        orchestratorTaskId: TaskIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(`"${CHILD_ID}" was started in another chat`);
  });
});

// A grant tells the task itself, so no `send` has to follow it.
describe("task folder, telling the task", () => {
  it("starts an idle task on the folder it was handed", async () => {
    const result = await runFolder(
      [CHILD_ID, "--add", "/mnt/home/Downloads"],
      context,
    );

    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "<id> now has /mnt/home/Downloads (read-write).
      Sent to <id>, which carries on with it now; you will be told when it finishes.
      "
    `);
    expect(delivered()).toMatchInlineSnapshot(`
      [
        "You were handed the folder Downloads at /mnt/Downloads, read and write.",
      ]
    `);
  });

  it("steers a working task, with what the folder is for", async () => {
    working.value = true;
    const result = await runFolder(
      [CHILD_ID, "--add", "/mnt/home/Desktop:ro"],
      context,
      "The invoices you were missing are in /mnt/home/Desktop/invoices.",
    );

    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "<id> now has /mnt/home/Desktop (read-only).
      Sent to <id>, which is busy and hears this at its next step; you will be told when its turn finishes.
      "
    `);
    expect(delivered()).toMatchInlineSnapshot(`
      [
        "You were handed the folder Desktop at /mnt/Desktop, read-only.

      The invoices you were missing are in /mnt/Desktop/invoices.",
      ]
    `);
  });

  it("leaves an idle task idle when it only lost a folder", async () => {
    await runFolder([CHILD_ID, "--add", "/mnt/home/Downloads"], context);
    sent.events = [];

    const result = await runFolder(
      [CHILD_ID, "--remove", "/mnt/home/Downloads"],
      context,
    );

    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "Took /mnt/home/Downloads back from <id>.
      <id> is not running; it is told when its next turn starts.
      "
    `);
    expect(delivered()).toEqual([]);
  });

  it("takes every folder but the workspace folder with --none", async () => {
    await runFolder(
      [CHILD_ID, "--add", "/mnt/home/Downloads", "--add", "/mnt/home/Desktop"],
      context,
    );
    await attachFolder({
      access: "read-write",
      path: outputFolderPath(),
      taskId: CHILD_ID,
    });
    working.value = true;
    sent.events = [];

    const result = await runFolder([CHILD_ID, "--none"], context);

    expect(result.stdout.replaceAll(CHILD_ID, "<id>")).toMatchInlineSnapshot(`
      "Took /mnt/home/Downloads back from <id>.
      Took /mnt/home/Desktop back from <id>.
      Sent to <id>, which is busy and hears this at its next step; you will be told when its turn finishes.
      "
    `);
    expect(delivered()).toMatchInlineSnapshot(`
      [
        "The folder Downloads at /mnt/Downloads was taken back from you. The folder Desktop at /mnt/Desktop was taken back from you.",
      ]
    `);
    expect(Object.keys(await heldBy(CHILD_ID))).toEqual([outputFolderPath()]);
  });

  it("refuses a message naming a folder the task will not have, changing nothing", async () => {
    await expect(
      runFolder(
        [CHILD_ID, "--add", "/mnt/home/Desktop"],
        context,
        "Compare it with /mnt/home/Downloads/list.csv.",
      ),
    ).rejects.toThrow(/add it on this command with --add <path>/);
    expect(await heldBy(CHILD_ID)).toEqual({});
    expect(delivered()).toEqual([]);
  });
});

describe("the folder a task keeps", () => {
  it("refuses to take the workspace folder away", async () => {
    // Named by the task's own mount, since the workspace folder is under the
    // real home rather than this test's, so no mount of the conversation's
    // covers it here.
    const attached = await attachFolder({
      access: "read-write",
      path: outputFolderPath(),
      taskId: CHILD_ID,
    });

    await expect(
      runFolder([CHILD_ID, "--remove", `/mnt/${attached.mountName}`], context),
    ).rejects.toThrow(/every task keeps the workspace folder/);
    expect(await heldBy(CHILD_ID)).toHaveProperty(outputFolderPath());
  });
});
