import fs from "node:fs";
import path from "node:path";

import { type FileUpload } from "../../schemas/file-upload";
import { AbsolutePathSchema } from "../../schemas/paths";
import { getMimeType } from "../get-mime-type";
import {
  draftFolderItems,
  findDraft,
  namedByOtherDrafts,
} from "./draft-folder";

/** What a message is sent with besides its words. */
interface Sending {
  files: FileUpload.Type[];
  folders: { path: string }[];
}

/**
 * What of a draft's folder a message carried, entry by entry, as the send
 * read it: each file, those inside a folder it sent included, and each
 * folder, innermost first. Only these are taken out once the message is
 * written; anything else is not the send's to delete.
 */
export interface SentFromDraft {
  files: string[];
  folders: string[];
}

/**
 * What a message from a draft is sent with: what the window handed over,
 * and everything in the draft's folder as it is now, read at the moment of
 * sending. The folder is what goes with the message, and a file that lands
 * there a beat before Send may not have reached the window yet, so the
 * window's list is never the whole of it.
 *
 * A file the window already sends by its path is not added twice, and
 * neither is a paste the window sends as bytes whose write has landed in the
 * folder: the same bytes, not merely the same name, since a file dropped in
 * can share a name with a paste. `sent` is what of the folder went, for
 * {@link removeSentFromDraft} to take out once the message is written,
 * leaving what another draft in a folder they share still names.
 */
export function withDraftFolder({
  files,
  folders,
  fromDraft,
  rootDir,
}: Partial<Sending> & {
  fromDraft: string | undefined;
  rootDir: string;
}): Sending & { sent: SentFromDraft } {
  const given = { files: files ?? [], folders: folders ?? [] };
  const sent: SentFromDraft = { files: [], folders: [] };
  const entry =
    fromDraft === undefined ? undefined : findDraft(rootDir, fromDraft);
  if (entry === undefined) {
    return { ...given, sent };
  }
  const shared = namedByOtherDrafts(entry.dir, entry.draft.id);
  const byPath = new Set([
    ...given.files.flatMap((file) => ("path" in file ? [file.path] : [])),
    ...given.folders.map((folder) => folder.path),
  ]);
  const pasted = given.files.flatMap((file) =>
    "content" in file ? [Buffer.from(file.content, "base64")] : [],
  );
  const added: Sending = { files: [], folders: [] };
  const goes = (item: { kind: "file" | "folder"; path: string }) => {
    if (shared.has(item.path)) {
      return;
    }
    if (item.kind === "folder") {
      const inside = entriesUnder(item.path);
      sent.files.push(...inside.files);
      sent.folders.push(...inside.folders, item.path);
    } else {
      sent.files.push(item.path);
    }
  };
  for (const item of draftFolderItems(entry)) {
    if (byPath.has(item.path)) {
      goes(item);
      continue;
    }
    if (item.kind === "folder") {
      added.folders.push({ path: item.path });
      goes(item);
      continue;
    }
    let size: number;
    try {
      size = fs.statSync(item.path).size;
    } catch {
      // Gone since the listing: nothing to send.
      continue;
    }
    const sameBytes = pasted.findIndex(
      (bytes) => bytes.byteLength === size && sameAs(item.path, bytes),
    );
    if (sameBytes !== -1) {
      // The window sends this paste as its bytes; each counts once.
      pasted.splice(sameBytes, 1);
      goes(item);
      continue;
    }
    added.files.push({
      filename: path.basename(item.path),
      mimeType: getMimeType(item.path),
      path: AbsolutePathSchema.parse(item.path),
      size,
    });
    goes(item);
  }
  return {
    files: [...given.files, ...added.files],
    folders: [...given.folders, ...added.folders],
    sent,
  };
}

/**
 * Takes what a message carried out of its draft's folder, once the message
 * is written: the chat has its own copy of each by then, so sending moved
 * them. Only what the send read goes, file by file, and a folder only once
 * that leaves it empty, so whatever arrived after the send read the folder,
 * inside a folder it sent too, stays for the draft's removal to move to the
 * Trash. Answers what could not be taken out, which stays as well.
 */
export function removeSentFromDraft(sent: SentFromDraft): string[] {
  const stuck: string[] = [];
  for (const file of sent.files) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      stuck.push(file);
    }
  }
  for (const folder of sent.folders) {
    try {
      fs.rmdirSync(folder);
    } catch {
      // Something the send did not carry is still in it.
    }
  }
  return stuck;
}

/** Whether the file at `target` holds exactly `bytes`. */
function sameAs(target: string, bytes: Buffer): boolean {
  try {
    return fs.readFileSync(target).equals(bytes);
  } catch {
    return false;
  }
}

/**
 * Every file under a folder, links as files and never followed, and every
 * folder under it, innermost first.
 */
function entriesUnder(dir: string): SentFromDraft {
  const found: SentFromDraft = { files: [], folders: [] };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const inside = entriesUnder(at);
      found.files.push(...inside.files);
      found.folders.push(...inside.folders, at);
    } else {
      found.files.push(at);
    }
  }
  return found;
}
