/** What a drop on a `FileDropRegion` does with the files and folders let go there. */
export interface DropHandlers {
  onFilesDropped: (files: FileList) => void;
  onFoldersDropped?: (folders: DroppedFolder[]) => void;
}

export interface DroppedFolder {
  path: string;
  type: "folder";
}
