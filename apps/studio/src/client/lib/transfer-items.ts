import { type DroppedFolder } from "@/client/hooks/use-file-drop-region";

type TransferItem = Pick<DataTransferItem, "getAsFile" | "kind" | "type"> & {
  webkitGetAsEntry: () => null | Pick<FileSystemEntry, "isDirectory">;
};

/**
 * Split dropped or pasted items into files and folders.
 *
 * A folder copied in Finder or Explorer, or dragged in from either, arrives as
 * an item of kind `file` like any other, so handing every such item to the
 * file path would attach the folder as a file with no bytes behind it.
 * `webkitGetAsEntry` is what tells them apart, and it answers for drops and
 * pastes alike. Read it while the event is still being dispatched: the items
 * are emptied once it returns.
 *
 * `shouldAttachFile` filters the files only; a folder is always kept.
 * `unresolvedFolders` counts folders whose path could not be read.
 */
export function splitTransferItems({
  getFilePath,
  items,
  shouldAttachFile = () => true,
}: {
  getFilePath: (file: File) => string;
  items: Iterable<TransferItem>;
  shouldAttachFile?: (item: TransferItem) => boolean;
}) {
  const files: File[] = [];
  const folders: DroppedFolder[] = [];
  let unresolvedFolders = 0;

  for (const item of items) {
    if (item.kind !== "file") {
      continue;
    }

    const isDirectory = item.webkitGetAsEntry()?.isDirectory ?? false;
    const file = item.getAsFile();

    if (!isDirectory) {
      if (file && shouldAttachFile(item)) {
        files.push(file);
      }
      continue;
    }

    const path = file ? getFilePath(file) : "";
    if (path) {
      folders.push({ path, type: "folder" });
    } else {
      unresolvedFolders += 1;
    }
  }

  return { files, folders, unresolvedFolders };
}
