import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { displayPath, folderNameFromPath } from "@/client/lib/path-utils";
import { rpcClient } from "@/client/rpc/client";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { toast } from "sonner";

import { Button } from "./ui/button";

/**
 * The folders a sent message carried: the same anatomy the composer and the
 * project modal give a folder, without the controls.
 *
 * Access is deliberately absent. It is a property of the attachment as it
 * stands, not of the message, so a folder reattached at another level would
 * leave a label here describing a grant that no longer holds.
 */
export function FolderAttachmentsCard({
  folders,
}: {
  folders: SessionMessageDataPart.FolderAttachmentDataPart[];
}) {
  return (
    <div className="flex w-full justify-end">
      {/* One rounded block with rules between the folders, sized to its widest
          row: a set of folders is one list, not a card each. */}
      <div className="flex w-fit max-w-[80%] flex-col divide-y overflow-hidden rounded-lg border bg-background shadow-xs">
        {folders.map((folder) => (
          <FolderAttachmentPreview folder={folder} key={folder.id} />
        ))}
      </div>
    </div>
  );
}

function FolderAttachmentPreview({
  folder,
}: {
  folder: SessionMessageDataPart.FolderAttachmentDataPart;
}) {
  const handleClick = async () => {
    const [error] = await safe(
      rpcClient.utils.openFolder.call({ folderPath: folder.path }),
    );

    if (error) {
      toast.error("Failed to open folder", { description: error.message });
    }
  };

  return (
    <Button
      className="h-auto w-full justify-start gap-x-2.5 rounded-none px-3 py-2"
      onClick={() => void handleClick()}
      type="button"
      variant="ghost"
    >
      <MacFolderIcon className="size-8 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col text-left">
        {/* The stored name is the mount name the agent works through
            (`Home-Downloads`), which is not what the user picked; the folder's
            own name and where it lives are. */}
        <span className="truncate text-xs font-medium">
          {folderNameFromPath(folder.path)}
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
