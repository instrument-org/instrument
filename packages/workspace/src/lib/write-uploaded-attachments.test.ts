import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASK_FOLDER_NAMES } from "../constants";
import { FileUpload } from "../schemas/file-upload";
import { type ChatDir, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { getChatState } from "./chat-record";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

const CONTENT = "a photo, as far as the copy is concerned";

let root: string;
let dir: ChatDir;

beforeEach(async () => {
  root = await fs.mkdtemp(
    path.join(os.tmpdir(), "write-uploaded-attachments-"),
  );
  dir = ChatDirSchema.parse(path.join(root, "task"));
  await fs.mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

async function attach(files: FileUpload.Type[]) {
  const result = await writeUploadedAttachments({
    dir,
    files,
    messageId: StoreId.newMessageId(),
    sessionId: StoreId.newSessionId(),
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value.part.data.files;
}

async function attachFolder(folderPath: string) {
  const result = await writeUploadedAttachments({
    dir,
    folders: [{ path: folderPath }],
    messageId: StoreId.newMessageId(),
    sessionId: StoreId.newSessionId(),
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value.part.data.folders ?? [];
}

async function folderState() {
  const state = await getChatState(dir);
  return Object.values(state.attachedFolders ?? {});
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
  it("copies a file from outside the task into attachments", async () => {
    const file = await writeSourceFile(path.join(root, "outside", "photo.jpg"));

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(
      `${TASK_FOLDER_NAMES.attachments}/photo.jpg`,
    );
    await expect(
      fs.readFile(
        path.join(dir, TASK_FOLDER_NAMES.attachments, "photo.jpg"),
        "utf8",
      ),
    ).resolves.toBe(CONTENT);
  });

  // The user's way of saying "this one": reveal a file the task already holds
  // and drag it back into the composer. Copying it into `attachments/` would
  // fork it, so the attachment names the file where it already lives.
  it("attaches a file the task already holds where it lies", async () => {
    const file = await writeSourceFile(
      path.join(dir, TASK_FOLDER_NAMES.downloads, "photo.jpg"),
    );

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(`${TASK_FOLDER_NAMES.downloads}/photo.jpg`);
    await expect(
      fs.readdir(path.join(dir, TASK_FOLDER_NAMES.attachments)),
    ).resolves.toEqual([]);
  });

  // The private dir is off-limits to the agent, so a file dragged out of it is
  // copied in like any other outside file rather than referenced in place.
  it("copies a file out of the private dir into attachments", async () => {
    const file = await writeSourceFile(
      path.join(dir, TASK_FOLDER_NAMES.private, "notes.jpg"),
    );

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(
      `${TASK_FOLDER_NAMES.attachments}/notes.jpg`,
    );
  });

  it("gives a copy its own name when one is already attached", async () => {
    await writeSourceFile(
      path.join(dir, TASK_FOLDER_NAMES.attachments, "photo.jpg"),
      "the one attached earlier",
    );
    const file = await writeSourceFile(path.join(root, "outside", "photo.jpg"));

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe(
      `${TASK_FOLDER_NAMES.attachments}/photo-1.jpg`,
    );
  });

  describe("attached folders", () => {
    // The user sends a folder to work in; what a task may do there is the
    // conversation's to decide when it hands the folder over.
    it("attaches a sent folder read and write", async () => {
      const notes = path.join(root, "Notes");
      await fs.mkdir(notes);

      await attachFolder(notes);
      const attached = await folderState();

      expect(attached.map((folder) => folder.access)).toEqual(["read-write"]);
    });

    // A second mount over one directory would give the agent two names for
    // one folder.
    it("keeps one attachment for a folder sent twice", async () => {
      const notes = path.join(root, "Notes");
      await fs.mkdir(notes);

      await attachFolder(notes);
      const first = await folderState();
      const announced = await attachFolder(notes);
      const second = await folderState();

      expect(second).toEqual(first);
      expect(announced).toEqual([]);
    });
  });
});
