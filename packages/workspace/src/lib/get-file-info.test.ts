import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceFilePathSchema } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { getCurrentFileInfo } from "./get-file-info";
import { grantFolder } from "./chat/grants";

describe("getCurrentFileInfo", () => {
  let mountedModifiedAt: number;
  let root: string;
  let chatId: ChatId;
  let taskModifiedAt: number;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "file-info-"));
    const taskRoot = path.join(root, "tasks", "file-info-task");
    const photosRoot = path.join(root, "Photos");
    chatId = createMockChatConfigForDir(taskRoot);

    await fs.mkdir(taskRoot, { recursive: true });
    await fs.mkdir(photosRoot);
    await fs.writeFile(path.join(taskRoot, "notes.txt"), "task file");
    await fs.writeFile(path.join(photosRoot, "cat.png"), "mounted file");
    const taskStats = await fs.stat(path.join(taskRoot, "notes.txt"));
    const mountedStats = await fs.stat(path.join(photosRoot, "cat.png"));
    taskModifiedAt = taskStats.mtimeMs;
    mountedModifiedAt = mountedStats.mtimeMs;

    await grantFolder({ chatId, path: photosRoot, source: "attached" });
  });

  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it.each([
    [
      "a chat file",
      (): string => "notes.txt",
      "notes.txt",
      "text/plain",
      (): number => taskModifiedAt,
      (): string => path.join(root, "tasks", "file-info-task", "notes.txt"),
    ],
    [
      "a file in a granted folder",
      (): string => path.join(root, "Photos", "cat.png"),
      "cat.png",
      "image/png",
      (): number => mountedModifiedAt,
      (): string => path.join(root, "Photos", "cat.png"),
    ],
  ] as const)(
    "returns live metadata for %s, and where it is",
    async (
      _label,
      filePath,
      filename,
      mimeType,
      expectedModifiedAt,
      hostPath,
    ) => {
      const result = await getCurrentFileInfo({
        filePath: WorkspaceFilePathSchema.parse(filePath()),
        chatId,
      });

      expect(result._unsafeUnwrap()).toEqual({
        filename,
        filePath: filePath(),
        hostPath: hostPath(),
        mimeType,
        modifiedAt: expectedModifiedAt(),
      });
    },
  );

  it("rejects a missing file", async () => {
    const missing = path.join(root, "Photos", "missing.png");
    const result = await getCurrentFileInfo({
      filePath: WorkspaceFilePathSchema.parse(missing),
      chatId,
    });

    expect(result._unsafeUnwrapErr().message).toBe(
      `File not found: ${missing}`,
    );
  });
});
