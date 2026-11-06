import { AttachedItemPreview } from "@/client/components/attached-item-preview";
import { FileOpenContext } from "@/client/components/file-open-context";
import { SystemFolderIcon } from "@/client/components/icons/folder-glyph";
import { wantsNewTab } from "@/client/hooks/use-open-target";
import { displayPath, folderLabel } from "@/client/lib/path-utils";
import { showInFolder } from "@/client/lib/show-in-files";
import {
  isFolderPath,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { useContext } from "react";

/**
 * The folders a sent message carried, as the chips the composer gave them:
 * each its name, its whole place in its tooltip, and a press that opens it.
 *
 * Access is absent: what the agent may do in a folder belongs to the chat's
 * mount of it, not to the message that sent it.
 */
export function SentFolderChips({
  folders,
}: {
  folders: SessionMessageDataPart.SentFolderDataPart[];
}) {
  // Opened where the surface opens files, which in a chat is the chat's own
  // tabs; a surface with nowhere to open it shows the folder in Finder.
  const openFile = useContext(FileOpenContext);
  return folders.map((folder) => (
    <AttachedItemPreview
      hostPath={folder.path}
      icon={<SystemFolderIcon className="size-4 shrink-0" />}
      key={folder.path}
      label={folderLabel(folder.path)}
      onClick={(event) => {
        if (openFile) {
          openFile(
            isFolderPath(folder.path) ? folder.path : `${folder.path}/`,
            wantsNewTab(event) ? { newTab: true } : {},
          );
          return;
        }
        void showInFolder(folder.path, { kind: "folder" });
      }}
      tooltip={displayPath(folder.path)}
    />
  ));
}
