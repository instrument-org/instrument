import { type ImageModelV3 } from "@ai-sdk/provider";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { measureImage } from "../lib/render-image";
import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { runTool } from "../test/helpers/run-tool";
import { withTempDir } from "../test/helpers/temp-dir";
import { GenerateImage } from "./generate-image";

// 1x1 transparent PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** A HEIC still, the format an iPhone hands over. */
const HEIC_FIXTURE = path.resolve(
  import.meta.dirname,
  "../../fixtures/assets/photo.heic",
);

const doGenerate = vi.fn().mockResolvedValue({
  images: [PNG_BASE64],
  rawResponse: { headers: {} },
  usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
  warnings: [],
});

const mockImageModel: ImageModelV3 = {
  doGenerate,
  maxImagesPerCall: undefined,
  modelId: "mock-image-model",
  provider: "mock-provider",
  specificationVersion: "v3",
};

const model = createMockAIGatewayModel();
const root = withTempDir("generate-image");

let taskId: TaskId;
let photosDir: string;
let photos: FolderAttachment.Type;
let attachedFolders: Record<string, FolderAttachment.Type>;

beforeEach(async () => {
  photosDir = path.join(root.path, "Photos");
  const taskDir = path.join(root.path, "tasks", "test");
  await fs.mkdir(photosDir, { recursive: true });
  await fs.mkdir(taskDir, { recursive: true });

  taskId = createMockTaskConfigForDir(taskDir, {
    imageModel: mockImageModel,
    model,
  });
  photos = {
    access: "read-only",
    createdAt: 0,
    id: FolderAttachment.IdSchema.parse("photos-id"),
    mountName: "Photos",
    path: AbsolutePathSchema.parse(photosDir),
    source: "user",
  };
  attachedFolders = { Photos: photos };
});

function makeExecuteArgs(
  input: Parameters<typeof GenerateImage.execute>[0]["input"],
) {
  return {
    agentName: "main" as const,
    input,
    model,
    signal: AbortSignal.timeout(30_000),
    spawnAgent: vi.fn(),
    taskId,
    taskState: { attachedFolders },
  };
}

/**
 * What the reference images handed to the provider actually are, read from
 * their bytes.
 *
 * Not the media type the request declares: the AI SDK labels a buffer it cannot
 * identify `image/png` regardless, so a HEIC that reached the provider
 * unconverted would announce itself as a PNG and an assertion on that would
 * pass while the bug shipped.
 */
function sentSourceImageFormats() {
  // `vi.fn()` records its arguments untyped; this names what the call holds.
  const options = doGenerate.mock.calls[0]?.[0] as
    | Parameters<ImageModelV3["doGenerate"]>[0]
    | undefined;
  return options?.files?.map((file) =>
    file.type === "file" ? measureImage(Buffer.from(file.data))?.format : "url",
  );
}

describe("GenerateImage source images", () => {
  it("accepts a source image from a read-only mount and echoes its mount path", async () => {
    await fs.writeFile(
      path.join(photosDir, "cat.png"),
      Buffer.from(PNG_BASE64, "base64"),
    );

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

  // The whole point of the conversion pass: what leaves here is a format the
  // provider accepts, whatever the user happened to attach. A HEIC reaching it
  // comes back as a 400 that names the image by position and nothing else.
  it("converts a phone photo before the provider ever sees it", async () => {
    await fs.copyFile(HEIC_FIXTURE, path.join(photosDir, "IMG_4021.heic"));

    const result = await runTool(
      GenerateImage,
      makeExecuteArgs({
        explanation: "remix",
        filePath: "output/remix",
        prompt: "A stylized version of the photo",
        sourceImages: ["/mnt/Photos/IMG_4021.heic"],
      }),
    );

    expect(result._unsafeUnwrap().state).toBe("success");
    expect(sentSourceImageFormats()).toEqual(["png"]);
  }, 30_000);

  it("errors cleanly when a mount source image does not exist", async () => {
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
    await fs.writeFile(path.join(photosDir, "cat.png"), "<!doctype html>");

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
    await fs.writeFile(
      path.join(photosDir, "cat.png"),
      Buffer.from(PNG_BASE64, "base64"),
    );

    const result = await runTool(
      GenerateImage,
      makeExecuteArgs({
        explanation: "remix",
        filePath: "output/remix",
        prompt: "x",
        sourceImages: [path.join(photosDir, "cat.png")],
      }),
    );

    expect(result._unsafeUnwrapErr().message).toContain('"/mnt/Photos/..."');
  });

  // Everything below the path resolve assumes a task-relative path, so a mount
  // path has to be refused rather than joined onto the task directory.
  it("refuses to generate into a mount path, whatever its access", async () => {
    const result = await runTool(GenerateImage, {
      ...makeExecuteArgs({
        explanation: "write into the folder",
        filePath: "/mnt/Photos/generated",
        prompt: "A cat",
      }),
      taskState: {
        attachedFolders: { Photos: { ...photos, access: "read-write" } },
      },
    });

    const error = result._unsafeUnwrapErr();
    expect(error.message).toContain("cannot be generated directly into");
    await expect(fs.readdir(photosDir)).resolves.toEqual([]);
  });
});
