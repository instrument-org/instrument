import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASK_FOLDER_NAMES } from "../constants";
import { FileUpload } from "../schemas/file-upload";
import { type FolderAttachment } from "../schemas/folder-attachment";
import { type TaskDir, TaskDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { getTaskState } from "./task-record";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

const CONTENT = "a photo, as far as the copy is concerned";

let root: string;
let dir: TaskDir;

beforeEach(async () => {
  root = await fs.mkdtemp(
    path.join(os.tmpdir(), "write-uploaded-attachments-"),
  );
  dir = TaskDirSchema.parse(path.join(root, "task"));
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

async function attachFolder(
  folderPath: string,
  access: FolderAttachment.Access,
) {
  const result = await writeUploadedAttachments({
    dir,
    folders: [{ access, path: folderPath }],
    messageId: StoreId.newMessageId(),
    sessionId: StoreId.newSessionId(),
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value.part.data.folders ?? [];
}

async function folderState() {
  const state = await getTaskState(dir);
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
    // Attaching a folder that is already attached is how the composer says
    // "this one, with this access", so the grant it arrives with wins in both
    // directions. Widening used to be dropped, which left a folder attached
    // read-only with no way to make it writable at all.
    it.each([
      { from: "read-only", to: "read-write" },
      { from: "read-write", to: "read-only" },
    ] as const)("re-attaching regrants $from to $to", async ({ from, to }) => {
      const folderPath = path.join(root, "Notes");
      await fs.mkdir(folderPath);

      await attachFolder(folderPath, from);
      const first = await folderState();
      await attachFolder(folderPath, to);
      const second = await folderState();

      expect(second).toHaveLength(1);
      expect(second[0]?.access).toBe(to);
      // The same attachment throughout: a second mount over one directory could
      // disagree with the first about what the agent may do there.
      expect(second[0]?.id).toBe(first[0]?.id);
      expect(second[0]?.createdAt).toBe(first[0]?.createdAt);
    });

    // Only the folder that was re-attached: the message carries the access for
    // the folders in it, and says nothing about the rest.
    it("leaves the other folders alone", async () => {
      const notes = path.join(root, "Notes");
      const photos = path.join(root, "Photos");
      await fs.mkdir(notes);
      await fs.mkdir(photos);

      await attachFolder(notes, "read-only");
      await attachFolder(photos, "read-only");
      await attachFolder(notes, "read-write");

      const attached = await folderState();
      const byPath = new Map<string, FolderAttachment.Access>(
        attached.map((folder) => [folder.path, folder.access]),
      );
      expect(byPath.get(notes)).toBe("read-write");
      expect(byPath.get(photos)).toBe("read-only");
    });
  });
});
