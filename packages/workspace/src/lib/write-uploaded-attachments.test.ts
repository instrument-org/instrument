import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHAT_FOLDER_NAMES } from "../constants";
import { FileUpload } from "../schemas/file-upload";
import {
  type ChatDir,
  ChatDirSchema,
  type WorkDir,
  WorkDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

const CONTENT = "a photo, as far as the copy is concerned";

let root: string;
let recordDir: ChatDir;
let workDir: WorkDir;

beforeEach(async () => {
  root = await fs.mkdtemp(
    path.join(os.tmpdir(), "write-uploaded-attachments-"),
  );
  recordDir = ChatDirSchema.parse(path.join(root, "workspace", "chats", "c"));
  workDir = WorkDirSchema.parse(path.join(root, "machine", "work", "c"));
  await fs.mkdir(recordDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

async function attach(files: FileUpload.Type[]) {
  const result = await writeUploadedAttachments({
    files,
    messageId: StoreId.newMessageId(),
    recordDir,
    sessionId: StoreId.newSessionId(),
    workDir,
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value.part.data.files;
}

// Writes `content` at `filePath` and describes it the way the composer does.
async function writeSourceFile(filePath: string, content = CONTENT) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return FileUpload.Schema.parse({
    filename: path.basename(filePath),
    mimeType: "image/jpeg",
    path: filePath,
    size: Buffer.byteLength(content),
  });
}

describe("writeUploadedAttachments", () => {
  it("copies a file from outside the chat into its record folder's attachments", async () => {
    const file = await writeSourceFile(path.join(root, "outside", "photo.jpg"));

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(
      `${CHAT_FOLDER_NAMES.attachments}/photo.jpg`,
    );
    await expect(
      fs.readFile(
        path.join(recordDir, CHAT_FOLDER_NAMES.attachments, "photo.jpg"),
        "utf8",
      ),
    ).resolves.toBe(CONTENT);
    await expect(
      fs.access(path.join(workDir, CHAT_FOLDER_NAMES.attachments)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  // The user's way of saying "this one": reveal a file the chat's work folder
  // already holds and drag it back into the composer. Copying it into
  // `attachments/` would fork it, so the attachment names the file where it
  // already lives, by its path in the work folder.
  it("attaches a file the work folder already holds where it lies", async () => {
    const file = await writeSourceFile(
      path.join(workDir, CHAT_FOLDER_NAMES.downloads, "photo.jpg"),
    );

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(`${CHAT_FOLDER_NAMES.downloads}/photo.jpg`);
    await expect(
      fs.readdir(path.join(recordDir, CHAT_FOLDER_NAMES.attachments)),
    ).resolves.toEqual([]);
  });

  it("gives a copy its own name when one is already attached", async () => {
    await writeSourceFile(
      path.join(recordDir, CHAT_FOLDER_NAMES.attachments, "photo.jpg"),
      "the one attached earlier",
    );
    const file = await writeSourceFile(path.join(root, "outside", "photo.jpg"));

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(
      `${CHAT_FOLDER_NAMES.attachments}/photo-1.jpg`,
    );
  });

  // The record folder is not where the agent works, so a file sent before and
  // sent again is a new attachment rather than a path in the work folder.
  it("copies a file from the chat's own attachments as a new one", async () => {
    const file = await writeSourceFile(
      path.join(recordDir, CHAT_FOLDER_NAMES.attachments, "photo.jpg"),
    );

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(
      `${CHAT_FOLDER_NAMES.attachments}/photo-1.jpg`,
    );
  });
});
