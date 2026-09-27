import { call, ORPCError } from "@orpc/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceConfig } from "../../lib/workspace-config";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { type WorkspaceRPCContext } from "../base";
import { computer } from "./computer";

const taskId = createMockTaskConfig(TaskIdSchema.parse("computer-route"));

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "computer-route-"));
  await fs.writeFile(path.join(tmpDir, "notes.md"), "# Notes\n");
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

function createContext(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // The listing never reads the actor ref, so the cast spares the test
    // booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

describe("workspace.computer.list", () => {
  it.each([
    ["a file", "notes.md"],
    ["a path through a file", path.join("notes.md", "inside")],
  ])("answers NOT_A_FOLDER for %s", async (_, relative) => {
    const target = path.join(tmpDir, relative);
    const listing = call(
      computer.list,
      { id: taskId, path: target },
      { context: createContext() },
    );

    await expect(listing).rejects.toBeInstanceOf(ORPCError);
    await expect(listing).rejects.toMatchObject({
      code: "NOT_A_FOLDER",
      data: { path: target },
      defined: true,
    });
  });

  it("lists a folder", async () => {
    const listing = await call(
      computer.list,
      { id: taskId, path: tmpDir },
      { context: createContext() },
    );

    expect(listing.entries.map((entry) => entry.name)).toEqual(["notes.md"]);
  });
});
