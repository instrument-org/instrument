import mockFs from "mock-fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockTaskConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-task-config";
import { runTool } from "../test/helpers/run-tool";
import { SaveSkill } from "./save-skill";

const model = createMockAIGatewayModel();
const taskId = createMockTaskConfig(TaskIdSchema.parse("save-skill"), {
  model,
});

function execute(
  input: Parameters<typeof SaveSkill.execute>[0]["input"],
) {
  return runTool(SaveSkill, {
    agentName: "main",
    input,
    model,
    signal: AbortSignal.timeout(10_000),
    spawnAgent: vi.fn(),
    taskId,
    taskState: {},
  });
}

describe("SaveSkill", () => {
  afterEach(() => {
    mockFs.restore();
  });

  it("atomically creates a workspace skill package", async () => {
    mockFs({ [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} } });

    const result = await execute({
      description: "Reviews API changes when users ask for compatibility help.",
      explanation: "Saving the finished skill",
      instructions: "# API reviewer\n\nCheck compatibility before suggesting changes.",
      name: "review-api",
      resources: [
        {
          content: "# Compatibility\n\nPreserve public fields.",
          path: "references/compatibility.md",
        },
      ],
    });

    expect(result._unsafeUnwrap()).toEqual({
      files: ["SKILL.md", "references/compatibility.md"],
      name: "review-api",
      path: "skills/review-api",
    });
    const skillDir = path.join(
      MOCK_WORKSPACE_DIRS.tasks,
      "..",
      "skills",
      "review-api",
    );
    await expect(fs.readFile(path.join(skillDir, "SKILL.md"), "utf8"))
      .resolves.toMatchInlineSnapshot(`
        "---
        name: review-api
        description: "Reviews API changes when users ask for compatibility help."
        ---

        # API reviewer

        Check compatibility before suggesting changes.
        "
      `);
    await expect(
      fs.readFile(path.join(skillDir, "references/compatibility.md"), "utf8"),
    ).resolves.toBe("# Compatibility\n\nPreserve public fields.");
  });

  it.each([
    "../outside.md",
    "/outside.md",
    "scripts\\unsafe.ts",
    "SKILL.md",
    "references/SKILL.md",
  ])(
    "rejects unsafe resource path %s",
    async (resourcePath) => {
      mockFs({ [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} } });

      const result = await execute({
        description: "Description",
        explanation: "Testing validation",
        instructions: "# Instructions",
        name: "safe-skill",
        resources: [{ content: "unsafe", path: resourcePath }],
      });

      expect(result.isErr()).toBe(true);
      await expect(
        fs.stat(
          path.join(MOCK_WORKSPACE_DIRS.tasks, "..", "skills", "safe-skill"),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("refuses to replace an existing skill", async () => {
    mockFs({
      "/tmp/workspace": {
        skills: { existing: { "SKILL.md": "keep me" } },
        tasks: { [taskId]: {} },
      },
    });

    const result = await execute({
      description: "Description",
      explanation: "Testing duplicate handling",
      instructions: "# Replacement",
      name: "existing",
    });

    expect(result._unsafeUnwrapErr().message).toContain("already exists");
    await expect(
      fs.readFile(
        path.join(MOCK_WORKSPACE_DIRS.tasks, "..", "skills/existing/SKILL.md"),
        "utf8",
      ),
    ).resolves.toBe("keep me");
  });
});
