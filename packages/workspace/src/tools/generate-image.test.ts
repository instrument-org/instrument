import { type ImageModelV3 } from "@ai-sdk/provider";
import mockFs from "mock-fs";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import {
  createMockTaskConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-task-config";
import { runTool } from "../test/helpers/run-tool";
import { GenerateImage } from "./generate-image";

// 1x1 transparent PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const mockImageModel: ImageModelV3 = {
  doGenerate: vi.fn().mockResolvedValue({
    images: [PNG_BASE64],
    rawResponse: { headers: {} },
    usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
    warnings: [],
  }),
  maxImagesPerCall: undefined,
  modelId: "mock-image-model",
  provider: "mock-provider",
  specificationVersion: "v3",
};

const model = createMockAIGatewayModel();
const taskId = createMockTaskConfig(TaskIdSchema.parse("test"), {
  imageModel: mockImageModel,
  model,
});

const attachedFolders: Record<string, FolderAttachment.Type> = {
  Photos: {
    access: "read-only",
    createdAt: 0,
    id: FolderAttachment.IdSchema.parse("photos-id"),
    mountName: "Photos",
    path: AbsolutePathSchema.parse("/ext/Photos"),
    source: "user",
  },
};

function makeExecuteArgs(
  input: Parameters<typeof GenerateImage.execute>[0]["input"],
) {
  return {
    agentName: "main" as const,
    input,
    model,
    signal: AbortSignal.timeout(10_000),
    spawnAgent: vi.fn(),
    taskId,
    taskState: { attachedFolders },
  };
}

describe("GenerateImage source images", () => {
  afterEach(() => {
    mockFs.restore();
  });

  it("accepts a source image from a read-only mount and echoes its mount path", async () => {
    mockFs({
      "/ext/Photos": { "cat.png": Buffer.from(PNG_BASE64, "base64") },
      [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} },
    });

    const result = await runTool(
      GenerateImage,
      makeExecuteArgs({
        explanation: "remix",
        filePath: "output/remix",
        prompt: "A stylized version of the cat",
        sourceImages: ["/mnt/Photos/cat.png"],
      }),
    );

    const output = result._unsafeUnwrap();
    expect(output.state).toBe("success");
    if (output.state === "success") {
      expect(output.sourceImages).toEqual([
        { filePath: "/mnt/Photos/cat.png", modifiedAt: expect.any(Number) },
      ]);
      expect(output.images[0]?.filePath).toBe("output/remix.png");
    }
  });

  it("errors cleanly when a mount source image does not exist", async () => {
    mockFs({
      "/ext/Photos": {},
      [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} },
    });

    const result = await runTool(
      GenerateImage,
      makeExecuteArgs({
        explanation: "remix",
        filePath: "output/remix",
        prompt: "x",
        sourceImages: ["/mnt/Photos/missing.png"],
      }),
    );

    expect(result._unsafeUnwrapErr().message).toBe(
      "Source image not found: /mnt/Photos/missing.png",
    );
  });

  it("refuses a source image the model could not decode, naming the file", async () => {
    mockFs({
      "/ext/Photos": { "cat.png": Buffer.from("<!doctype html>") },
      [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} },
    });

    const result = await runTool(
      GenerateImage,
      makeExecuteArgs({
        explanation: "remix",
        filePath: "output/remix",
        prompt: "x",
        sourceImages: ["/mnt/Photos/cat.png"],
      }),
    );

    expect(result._unsafeUnwrapErr().message).toBe(
      "Source image /mnt/Photos/cat.png is not readable as an image. It may be truncated, or it may not be the format its name claims.",
    );
  });

  it("steers a real host path to the folder's mount path", async () => {
    mockFs({
      "/ext/Photos": { "cat.png": Buffer.from(PNG_BASE64, "base64") },
      [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} },
    });

    const result = await runTool(
      GenerateImage,
      makeExecuteArgs({
        explanation: "remix",
        filePath: "output/remix",
        prompt: "x",
        sourceImages: ["/ext/Photos/cat.png"],
      }),
    );

    expect(result._unsafeUnwrapErr().message).toContain('"/mnt/Photos/..."');
  });

  // Everything below the path resolve assumes a task-relative path, so a mount
  // path has to be refused rather than joined onto the task directory.
  it("refuses to generate into a mount path, whatever its access", async () => {
    mockFs({
      "/ext/Photos": {},
      [MOCK_WORKSPACE_DIRS.tasks]: { [taskId]: {} },
    });

    const result = await runTool(GenerateImage, {
      ...makeExecuteArgs({
        explanation: "write into the folder",
        filePath: "/mnt/Photos/generated",
        prompt: "A cat",
      }),
      taskState: {
        attachedFolders: {
          Photos: {
            access: "read-write",
            createdAt: 0,
            id: FolderAttachment.IdSchema.parse("photos-id"),
            mountName: "Photos",
            path: AbsolutePathSchema.parse("/ext/Photos"),
            source: "user",
          },
        },
      },
    });

    const error = result._unsafeUnwrapErr();
    expect(error.message).toContain("cannot be generated directly into");
    await expect(fs.readdir("/ext/Photos")).resolves.toEqual([]);
  });
});
