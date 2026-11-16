import { type StoreId } from "../../schemas/store-id";
import { type TranscriptMessage } from "./transcript-message";

/**
 * How a reply's card draws one file it handed over: from the copy its turn
 * kept, when a later turn changed the file, or as the file is now with word
 * that it changed since, when that copy is on another computer or was never
 * made. A file no later turn changed is drawn as it is now and has no entry.
 */
export type CardFileVersion =
  | { changedSince: true }
  | { changedSince: false; copy: string };

/**
 * Each message's files that its card draws other than as they are now, by
 * the path its files fence wrote. Read from the `data-fileVersions` parts:
 * a file whose newest recorded contents are not the ones this message's
 * turn left is one a later turn changed.
 *
 * Files are matched by name alone, since the folder a file sits in can be
 * renamed between turns (a chat's folder takes its title after the first).
 * Two files of one name in one chat can then pass for each other, which
 * at worst draws a turn's own copy where the file itself would do.
 */
export function cardFileVersions(
  messages: readonly TranscriptMessage[],
): Map<StoreId.Message, Map<string, CardFileVersion>> {
  const newest = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-fileVersions") {
        for (const file of part.data.files) {
          newest.set(fileKey(file.hostPath), file.hash);
        }
      }
    }
  }
  const found = new Map<StoreId.Message, Map<string, CardFileVersion>>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type !== "data-fileVersions" ||
        part.data.restore !== undefined
      ) {
        continue;
      }
      for (const file of part.data.files) {
        if (newest.get(fileKey(file.hostPath)) === file.hash) {
          continue;
        }
        const files =
          found.get(message.id) ?? new Map<string, CardFileVersion>();
        files.set(
          file.path,
          file.copy === undefined
            ? { changedSince: true }
            : { changedSince: false, copy: file.copy },
        );
        found.set(message.id, files);
      }
    }
  }
  return found;
}

/** The last part of a path, on either system's separator. */
function fileKey(hostPath: string): string {
  return hostPath.split(/[\\/]/u).at(-1) ?? hostPath;
}
