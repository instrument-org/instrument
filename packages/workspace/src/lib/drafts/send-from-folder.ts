import fs from "node:fs";
import path from "node:path";

import { type FileUpload } from "../../schemas/file-upload";
import { AbsolutePathSchema } from "../../schemas/paths";
import { getMimeType } from "../get-mime-type";
import { draftFolderItems, findDraft } from "./draft-folder";

/** What a message is sent with besides its words. */
interface Sending {
  files: FileUpload.Type[];
  folders: { path: string }[];
}

/**
 * What a message from a draft is sent with: what the window handed over,
 * and everything in the draft's folder as it is now, read at the moment of
 * sending. The folder is what goes with the message, and a file that lands
 * there a beat before Send may not have reached the window yet, so the
 * window's list is never the whole of it.
 *
 * A file the window already sends by its path is not added twice, and
 * neither is a paste the window sends as bytes under the name it has in the
 * folder. `sent` is every path in the folder that went, for
 * {@link removeSentFromDraft} to take out once the message is written.
 */
export function withDraftFolder({
  files,
  folders,
  fromDraft,
  rootDir,
}: Partial<Sending> & {
  fromDraft: string | undefined;
  rootDir: string;
}): Sending & { sent: string[] } {
  const given = { files: files ?? [], folders: folders ?? [] };
  const entry =
    fromDraft === undefined ? undefined : findDraft(rootDir, fromDraft);
  if (entry === undefined) {
    return { ...given, sent: [] };
  }
  const items = draftFolderItems(entry);
  const byPath = new Set([
    ...given.files.flatMap((file) => ("path" in file ? [file.path] : [])),
    ...given.folders.map((folder) => folder.path),
  ]);
  const asBytes = new Set(
    given.files.flatMap((file) => ("content" in file ? [file.filename] : [])),
  );
  const added: Sending = { files: [], folders: [] };
  for (const item of items) {
    if (byPath.has(item.path)) {
      continue;
    }
    if (item.kind === "folder") {
      added.folders.push({ path: item.path });
      continue;
    }
    const filename = path.basename(item.path);
    if (asBytes.has(filename)) {
      continue;
    }
    let size: number;
    try {
      size = fs.statSync(item.path).size;
    } catch {
      // Gone since the listing: nothing to send.
      continue;
    }
    added.files.push({
      filename,
      mimeType: getMimeType(item.path),
      path: AbsolutePathSchema.parse(item.path),
      size,
    });
  }
  return {
    files: [...given.files, ...added.files],
    folders: [...given.folders, ...added.folders],
    sent: items.map((item) => item.path),
  };
}

/**
 * Takes what a message carried out of its draft's folder, once the message
 * is written: the chat has its own copy of each file and folder by then, so
 * sending moved them. What arrived after the send read the folder is left,
 * for the draft's removal to move to the Trash.
 */
export function removeSentFromDraft(sent: readonly string[]): void {
  for (const target of sent) {
    fs.rmSync(target, { force: true, recursive: true });
  }
}
