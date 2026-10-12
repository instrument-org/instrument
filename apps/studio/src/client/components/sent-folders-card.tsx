import { FileOpenContext } from "@/client/components/file-open-context";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { wantsNewTab } from "@/client/hooks/use-open-target";
import { displayPath, folderLabel } from "@/client/lib/path-utils";
import { showInFolder } from "@/client/lib/show-in-files";
import {
  isFolderPath,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { useContext } from "react";

import { Button } from "./ui/button";

/**
 * The folders a sent message carried: the same anatomy the composer and the
 * project modal give a folder, without the controls.
 *
 * Access is absent: what the agent may do in a folder belongs to the chat's
 * mount of it, not to the message that sent it.
 */
export function SentFoldersCard({
  folders,
}: {
  folders: SessionMessageDataPart.SentFolderDataPart[];
}) {
  return (
    <div className="flex w-full justify-end">
      {/* One rounded block with rules between the folders, sized to its widest
          row with enough room to read short paths comfortably: a set of folders
          is one list, not a card each. */}
      <div className="flex w-fit max-w-[80%] min-w-64 flex-col divide-y divide-black/5 overflow-hidden rounded-lg bg-background shadow-xs dark:divide-white/6">
        {folders.map((folder) => (
          <SentFolderPreview folder={folder} key={folder.path} />
        ))}
      </div>
    </div>
  );
}

function SentFolderPreview({
  folder,
}: {
  folder: SessionMessageDataPart.SentFolderDataPart;
}) {
  // Opened where the surface opens files, which in a chat is the chat's own
  // tabs; a surface with nowhere to open it shows the folder in Finder.
  const openFile = useContext(FileOpenContext);
  const handleClick = async (event: { ctrlKey: boolean; metaKey: boolean }) => {
    if (openFile) {
      openFile(
        isFolderPath(folder.path) ? folder.path : `${folder.path}/`,
        wantsNewTab(event) ? { newTab: true } : {},
      );
      return;
    }
    await showInFolder(folder.path, { kind: "folder" });
  };

  return (
    <Button
      className="h-auto w-full justify-start gap-x-2.5 rounded-none px-3 py-2"
      onClick={(event) => void handleClick(event)}
      type="button"
      variant="ghost"
    >
      <MacFolderIcon className="size-8 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col text-left">
        {/* The stored name is the mount name the agent works through
            (`Home-Downloads`), which is not what the user picked; the folder's
            own name and where it lives are. */}
        <span className="truncate text-xs font-medium">
          {folderLabel(folder.path)}
        </span>
        <span
          className="truncate text-xs text-muted-foreground"
          title={folder.path}
        >
          {displayPath(folder.path)}
        </span>
      </div>
    </Button>
  );
}
