import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskDirSchema } from "../schemas/paths";
import { getTaskState, updateTaskState } from "./task-state-store";

describe("updateTaskState", () => {
  let dir: ReturnType<typeof TaskDirSchema.parse>;

  beforeEach(async () => {
    dir = TaskDirSchema.parse(
      await fs.mkdtemp(path.join(os.tmpdir(), "task-state-store-")),
    );
  });

  afterEach(async () => {
    await fs.rm(dir, { force: true, recursive: true });
  });

  it("serializes concurrent functional updates", async () => {
    await Promise.all(
      ["linear", "notion"].map((slug) =>
        updateTaskState(dir, (state) => ({
          ...state,
          connectorGuidesRead: [...(state.connectorGuidesRead ?? []), slug],
        })),
      ),
    );

    const state = await getTaskState(dir);
    expect(state.connectorGuidesRead).toEqual(["linear", "notion"]);
  });
});
