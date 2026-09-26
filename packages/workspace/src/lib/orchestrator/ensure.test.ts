import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { forgetRecordFolders } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { ensureOrchestrator, windowTaskId } from "./ensure";

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ensure-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.join(rootDir, "template"),
    ),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    tasksDir: WorkspaceDirSchema.parse(path.join(rootDir, "tasks")),
  });
  await fs.mkdir(path.join(rootDir, "template"));
  forgetRecordFolders();
});

afterEach(async () => {
  forgetRecordFolders();
  await fs.rm(rootDir, { force: true, recursive: true });
});

const viaEnsure = async () => {
  const result = await ensureOrchestrator();
  return result._unsafeUnwrap().taskId;
};

it.each([
  { callers: [viaEnsure, viaEnsure], name: "two ensures" },
  { callers: [viaEnsure, windowTaskId], name: "ensure and windowTaskId" },
  {
    callers: [windowTaskId, viaEnsure, viaEnsure],
    name: "windowTaskId and two ensures",
  },
])(
  "makes one window record when $name ask at once",
  async ({ callers }) => {
    const ids = await Promise.all(callers.map((call) => call()));
    expect(new Set(ids)).toEqual(new Set(["instrument"]));
    expect(await fs.readdir(path.join(rootDir, "tasks"))).toEqual([
      "instrument",
    ]);
  },
);

it("finds the window record a finished ensure made", async () => {
  const first = await viaEnsure();
  expect(await viaEnsure()).toBe(first);
});
