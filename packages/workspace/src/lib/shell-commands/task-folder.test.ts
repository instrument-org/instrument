import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { attachFolder } from "../attach-folder";
import { initializeTask } from "../initialize-task";
import { outputFolderPath } from "../orchestrator/output-folder";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { runFolder, type TaskCommandContext } from "./task";

const ORCHESTRATOR_ID = TaskIdSchema.parse("orchestrator");
const CHILD_ID = TaskIdSchema.parse("find-the-vault");

const context: TaskCommandContext = {
  orchestratorTaskId: ORCHESTRATOR_ID,
  remainingYieldMs: () => 0,
};

let rootDir: string;
let home: string;

/** The folders a task holds, by path, with the access each carries. */
async function heldBy(taskId: typeof CHILD_ID) {
  const state = await getTaskState(taskDir(taskId));
  return Object.fromEntries(
    Object.values(state.attachedFolders ?? {}).map((folder) => [
      folder.path,
      folder.access,
    ]),
  );
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-folder-"));
  home = path.join(rootDir, "home");
  await fs.mkdir(path.join(home, "Downloads"), { recursive: true });
  await fs.mkdir(path.join(home, "Desktop"), { recursive: true });
  for (const id of [ORCHESTRATOR_ID, CHILD_ID]) {
    createMockTaskConfigForDir(path.join(rootDir, "tasks", id));
  }
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
  });
  for (const [id, settings] of [
    [ORCHESTRATOR_ID, { kind: "orchestrator" as const, name: "Conversation" }],
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

  it("refuses to hand over more access than the conversation has", async () => {
    await attachFolder({
      access: "read-only",
      path: path.join(home, "Desktop"),
      taskId: ORCHESTRATOR_ID,
    });

    await expect(
      runFolder([CHILD_ID, "--add", "/mnt/Desktop:rw"], context),
    ).rejects.toThrow(/read-only in this conversation/);
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

  it("needs one of --add or --remove", async () => {
    await expect(runFolder([CHILD_ID], context)).rejects.toThrow(
      /--add or --remove is required/,
    );
  });

  it("refuses a task that is not the orchestrator's", async () => {
    await expect(
      runFolder([CHILD_ID, "--add", "/mnt/home/Downloads:rw"], {
        ...context,
        orchestratorTaskId: TaskIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(/no task "find-the-vault" of yours/);
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
