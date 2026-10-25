import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";

import { CHAT_FOLDER_NAMES } from "../constants";
import { FileUpload } from "../schemas/file-upload";
import {
  AbsolutePathSchema,
  type ChatDir,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";
import { workspaceHostPath } from "./workspace-relative-path";
import {
  copyDraftFolders,
  writeUploadedAttachments,
} from "./write-uploaded-attachments";

const CONTENT = "a photo, as far as the record is concerned";

let root: string;
let recordDir: ChatDir;
let outsideDir: string;
const held = getWorkspaceConfig();

afterEach(() => {
  setWorkspaceConfig(held);
});

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

  // The record syncs with the workspace, so a file in it is kept by its place
  // there and found again on a computer where the workspace is elsewhere.
  it("records a file in the workspace by its place there", async () => {
    const workspaceRoot = path.join(root, "workspace");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(workspaceRoot),
    });
    const file = await writeSourceFile(
      path.join(workspaceRoot, "Notes", "Trip plan.jpg"),
    );

    const [attached] = await attach([file]);

    expect(attached?.filePath).toBe("workspace:/Notes/Trip plan.jpg");
    // What the model is told is the path as it was when the message was
    // written, which a later move of the workspace leaves alone.
    expect(attached?.agentPath).toBe(
      shellPath(path.join(workspaceRoot, "Notes", "Trip plan.jpg")),
    );
    expect(
      workspaceHostPath(attached?.filePath ?? "", "/Volumes/Other/Instrument"),
    ).toBe("/Volumes/Other/Instrument/Notes/Trip plan.jpg");
    await expect(attachmentsIn(recordDir)).resolves.toEqual([]);
  });

  // Pasted bytes have no file behind them, so they are written into the
  // chat's own folder, where the person can open what they sent.
  // What the person pasted into a draft is the app's own copy, in the
  // draft's folder, and sending the draft takes that folder away. The
  // message has to carry its own copy or it carries nothing.
  it("copies a file pasted into a draft rather than pointing at the draft", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
    });
    const pasted = path.join(
      root,
      "workspace",
      "Drafts",
      "2026-10-17",
      "photo.jpg",
    );
    const file = await writeSourceFile(pasted);

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
    // The draft's own copy is left for the draft to take away.
    await expect(fs.readFile(pasted, "utf8")).resolves.toBe(CONTENT);
  });

  it("copies a folder in a draft into the chat's attachments and leaves one elsewhere where it lies", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
    });
    const inDraft = path.join(
      root,
      "workspace",
      "Drafts",
      "2026-10-17",
      "Photos",
    );
    await writeSourceFile(path.join(inDraft, "a.jpg"));

    const sent = await copyDraftFolders({
      folders: [{ path: inDraft }, { path: outsideDir }],
      recordDir,
    });

    const copy = path.join(recordDir, CHAT_FOLDER_NAMES.attachments, "Photos");
    expect(sent).toEqual([{ path: copy }, { path: outsideDir }]);
    await expect(fs.readFile(path.join(copy, "a.jpg"), "utf8")).resolves.toBe(
      CONTENT,
    );
    // The draft's own is left for the send to take away once it is written.
    await expect(fs.readdir(inDraft)).resolves.toEqual(["a.jpg"]);
  });

  it("writes pasted bytes into the chat's own folder", async () => {
    const folder = path.join(root, "workspace", "Chats", "Quiet dishwashers");
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(getWorkspaceConfig().workspaceMachineDir, {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        getWorkspaceConfig().workspaceMachineDir,
        WORKSPACE_MACHINE_ENTRIES.chatFolders,
      ),
      JSON.stringify({ [path.basename(recordDir)]: "Quiet dishwashers" }),
    );
    // A workspace the person picked, so its top level is theirs and the
    // chat's folder is somewhere the agent may read what they sent.
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      outputDir: AbsolutePathSchema.parse(path.join(root, "workspace")),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
    });

    const [attached] = await attach([pastedFile("photo.jpg")]);

    // Stored the same way wherever they land, so what resolves them is
    // which folder holds them.
    expect(attached?.filePath).toBe(
      `${CHAT_FOLDER_NAMES.attachments}/photo.jpg`,
    );
    await expect(
      fs.readFile(
        path.join(folder, CHAT_FOLDER_NAMES.attachments, "photo.jpg"),
        "utf8",
      ),
    ).resolves.toBe(CONTENT);
    await expect(attachmentsIn(recordDir)).rejects.toThrow();
  });

  it("takes no name an older upload still has in the record folder", async () => {
    const folder = path.join(root, "workspace", "Chats", "Quiet dishwashers");
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(getWorkspaceConfig().workspaceMachineDir, {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        getWorkspaceConfig().workspaceMachineDir,
        WORKSPACE_MACHINE_ENTRIES.chatFolders,
      ),
      JSON.stringify({ [path.basename(recordDir)]: "Quiet dishwashers" }),
    );
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      outputDir: AbsolutePathSchema.parse(path.join(root, "workspace")),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
    });
    await writeSourceFile(
      path.join(recordDir, CHAT_FOLDER_NAMES.attachments, "photo.jpg"),
      "sent before the chat had its folder",
    );

    const [attached] = await attach([pastedFile("photo.jpg")]);

    // Both are `attachments/<name>` to the records, and the older one moves
    // in beside this one.
    expect(attached?.filePath).toBe(
      `${CHAT_FOLDER_NAMES.attachments}/photo-1.jpg`,
    );
    await expect(attachmentsIn(folder)).resolves.toEqual(["photo-1.jpg"]);
  });

  // Every workspace the app keeps in its own data: the folder under
  // `Chats/` is inside what the rules close to every command, so a file
  // written there is refused rather than read.
  it("writes pasted bytes into the record folder for a workspace in the app's own data", async () => {
    const folder = path.join(root, "workspace", "Chats", "Quiet dishwashers");
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(getWorkspaceConfig().workspaceMachineDir, {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        getWorkspaceConfig().workspaceMachineDir,
        WORKSPACE_MACHINE_ENTRIES.chatFolders,
      ),
      JSON.stringify({ [path.basename(recordDir)]: "Quiet dishwashers" }),
    );
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
    });

    const [attached] = await attach([pastedFile("photo.jpg")]);

    expect(attached?.filePath).toBe(
      `${CHAT_FOLDER_NAMES.attachments}/photo.jpg`,
    );
    await expect(attachmentsIn(recordDir)).resolves.toEqual(["photo.jpg"]);
    await expect(attachmentsIn(folder)).rejects.toThrow();
  });

  // A chat from before the folders, or one whose folder could not be made.
  it("writes pasted bytes into the record folder for a chat with no folder", async () => {
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
