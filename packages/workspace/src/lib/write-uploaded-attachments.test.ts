import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHAT_FOLDER_NAMES } from "../constants";
import { FileUpload } from "../schemas/file-upload";
import { type ChatDir, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

const CONTENT = "a photo, as far as the record is concerned";

let root: string;
let recordDir: ChatDir;
let outsideDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(
    path.join(os.tmpdir(), "write-uploaded-attachments-"),
  );
  recordDir = ChatDirSchema.parse(path.join(root, "workspace", "chats", "c"));
  // The person's own folder: nothing Instrument made, and nothing it watches.
  outsideDir = path.join(root, "home", "Pictures");
  await fs.mkdir(recordDir, { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });
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
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value.part.data.files;
}

// Writes `content` at `filePath` and describes it the way the composer does
// for a file the person pointed at.
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

// What the composer sends for bytes that came in without a file behind them:
// an image off the clipboard.
function pastedFile(filename: string, content = CONTENT) {
  return FileUpload.Schema.parse({
    content: Buffer.from(content).toString("base64"),
    filename,
  });
}

function attachmentsIn(dir: string) {
  return fs.readdir(path.join(dir, CHAT_FOLDER_NAMES.attachments));
}

describe("writeUploadedAttachments", () => {
  // The whole point: the agent opens the file the person pointed at, and an
  // edit it makes is an edit to that file. A copy would fork it, and a long
  // video would be cloned to say so.
  it("records a file from outside every Instrument folder where it lies", async () => {
    const file = await writeSourceFile(path.join(outsideDir, "photo.jpg"));

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(path.join(outsideDir, "photo.jpg"));
    await expect(attachmentsIn(recordDir)).resolves.toEqual([]);
  });

  // The user's way of saying "this one": reveal a file the chat has already
  // made and drag it back into the composer.
  it("records a file the chat's own work folder holds where it lies", async () => {
    const workDir = path.join(root, "machine", "work", "c");
    const file = await writeSourceFile(
      path.join(workDir, CHAT_FOLDER_NAMES.downloads, "photo.jpg"),
    );

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(
      path.join(workDir, CHAT_FOLDER_NAMES.downloads, "photo.jpg"),
    );
    await expect(attachmentsIn(recordDir)).resolves.toEqual([]);
  });

  // A file already in the record folder, sent again, is the same file: there
  // is nothing to copy it to and no second name to give it.
  it("records a file from the chat's own attachments where it lies", async () => {
    const file = await writeSourceFile(
      path.join(recordDir, CHAT_FOLDER_NAMES.attachments, "photo.jpg"),
    );

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(
      path.join(recordDir, CHAT_FOLDER_NAMES.attachments, "photo.jpg"),
    );
    await expect(attachmentsIn(recordDir)).resolves.toEqual(["photo.jpg"]);
  });

  // Pasted bytes have no file behind them, so they are written into the
  // record folder and named relative to it.
  it("writes pasted bytes into the record folder's attachments", async () => {
    const [attached] = await attach([pastedFile("photo.jpg")]);

    expect(attached?.filePath).toBe(
      `${CHAT_FOLDER_NAMES.attachments}/photo.jpg`,
    );
    await expect(
      fs.readFile(
        path.join(recordDir, CHAT_FOLDER_NAMES.attachments, "photo.jpg"),
        "utf8",
      ),
    ).resolves.toBe(CONTENT);
  });

  it("gives pasted bytes their own name when one is already attached", async () => {
    await writeSourceFile(
      path.join(recordDir, CHAT_FOLDER_NAMES.attachments, "photo.jpg"),
      "the one attached earlier",
    );

    const [attached] = await attach([pastedFile("photo.jpg")]);

    expect(attached?.filePath).toBe(
      `${CHAT_FOLDER_NAMES.attachments}/photo-1.jpg`,
    );
    await expect(attachmentsIn(recordDir)).resolves.toEqual([
      "photo-1.jpg",
      "photo.jpg",
    ]);
  });
});
