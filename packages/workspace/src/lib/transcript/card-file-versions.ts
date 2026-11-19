import { type StoreId } from "../../schemas/store-id";
import { type TranscriptMessage } from "./transcript-message";

/**
 * How a reply's card draws one file it handed over: from the copy its turn
 * kept (`copy`), when a later turn changed the file, or as the file is now,
 * with word that it changed since (`changedSince`) when that copy is on
 * another computer or was never made; and by its number, once the chat has
 * a second version of the file. A file no later turn changed and with one
 * version is drawn as it is now and has no entry.
 */
export type CardFileVersion =
  | { changedSince: false; copy?: string; number?: number }
  | { changedSince: true; number?: number };

/**
 * Each message's files that its card draws other than as they are now, or
 * by a number, by the path its files fence wrote. Read from the
 * `data-fileVersions` parts: a file whose newest recorded contents are not
 * the ones this message's turn left is one a later turn changed, and a file
 * with a version numbered past 1 has a second version. Files are matched by
 * where they were written, so two of one name in different folders stay
 * apart.
 */
export function cardFileVersions(
  messages: readonly TranscriptMessage[],
): Map<StoreId.Message, Map<string, CardFileVersion>> {
  const newest = new Map<string, string>();
  const most = new Map<string, number>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-fileVersions") {
        for (const file of part.data.files) {
          newest.set(file.hostPath, file.hash);
          most.set(
            file.hostPath,
            Math.max(most.get(file.hostPath) ?? 0, file.number ?? 0),
          );
        }
      }
    }
  }
  const found = new Map<StoreId.Message, Map<string, CardFileVersion>>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "data-fileVersions" || part.data.kind !== undefined) {
        continue;
      }
      for (const file of part.data.files) {
        const isChanged = newest.get(file.hostPath) !== file.hash;
        const number =
          (most.get(file.hostPath) ?? 0) > 1 ? file.number : undefined;
        if (!isChanged && number === undefined) {
          continue;
        }
        const files =
          found.get(message.id) ?? new Map<string, CardFileVersion>();
        files.set(
          file.path,
          !isChanged
            ? { changedSince: false, ...(number !== undefined && { number }) }
            : file.copy === undefined
              ? { changedSince: true, ...(number !== undefined && { number }) }
              : {
                  changedSince: false,
                  copy: file.copy,
                  ...(number !== undefined && { number }),
                },
        );
        found.set(message.id, files);
      }
    }
  }
  return found;
}
