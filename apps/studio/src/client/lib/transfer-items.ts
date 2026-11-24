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

/**
 * Places an app or the system puts a file only to hand it over: the Mac's
 * temporary folder (a screenshot thumbnail), an app's containers (what another
 * device copied, in useractivityd's), caches, Mail and Messages storage, a
 * Photos library, and Windows' temporary folder and Outlook's cache. iCloud
 * Drive and `Library/CloudStorage` are the person's own files.
 */
const BORROWED_PLACES = [
  /^(?:\/private)?\/var\/folders\//,
  /\/Library\/(?:Caches|Containers|Group Containers|Mail|Messages)\//,
  /\.photoslibrary\//,
  /[\\/]AppData[\\/]Local[\\/](?:Microsoft[\\/]Windows[\\/]INetCache|Temp)[\\/]/i,
];

/**
 * Whether the file at `path` is only lent by a drop or a paste. Its owner may
 * delete it, as macOS does a picture copied on an iPhone, and other reads of
 * it may be refused, so it is kept by its bytes, read as it arrives. A file
 * anywhere else is the person's own and is kept by its path.
 */
export function isBorrowedPath(path: string): boolean {
  return BORROWED_PLACES.some((place) => place.test(path));
}
