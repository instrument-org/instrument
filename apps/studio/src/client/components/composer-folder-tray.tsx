import {
  type FolderAccess,
  FolderAccessControl,
} from "@/client/components/folder-access-list";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { Button } from "@/client/components/ui/button";
import { BLOCK_CLOSE, BLOCK_OPEN } from "@/client/lib/motion";
import { displayPath, folderNameFromPath } from "@/client/lib/path-utils";
import { cn } from "@/client/lib/utils";
import { type FolderAttachment } from "@instrument-org/workspace/client";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { AnimatePresence, motion } from "motion/react";

/**
 * The folders this prompt will be worked in, listed beside the composer they
 * belong to.
 *
 * One row per folder: the way out on the left, where the folder is in the
 * middle, and what the agent may do with it on the right. Below them, the line
 * that says the list can grow -- which doubles as the empty state on surfaces
 * that offer to start one.
 */
export function ComposerFolderTray({
  className,
  disabled,
  folders,
  onAccessChange,
  onAdd,
  onRemove,
  showAdd,
}: {
  className?: string;
  disabled?: boolean;
  folders: FolderAccess[];
  onAccessChange: (path: string, access: FolderAttachment.Access) => void;
  onAdd: () => void;
  onRemove: (path: string) => void;
  /**
   * Whether the tray offers to add a folder. Off, it still lists the ones a
   * prompt already has -- otherwise a folder added from the plus menu would be
   * invisible and impossible to remove -- it just does not advertise itself.
   */
  showAdd?: boolean;
}) {
  return (
    // No gap: the space under a row belongs to the row, so it collapses with
    // one on its way out instead of leaving a band where it was.
    <div className={cn("flex flex-col px-4 pt-2 pb-1", className)}>
      {/* `initial={false}`: folders a draft already had are not arriving, and
          the first one on a surface that grows a tray for it is carried in by
          the tray opening around it. */}
      <AnimatePresence initial={false}>
        {folders.map((folder) => {
          const name = folderNameFromPath(folder.path);

          return (
            <motion.div
              animate={{ height: "auto", opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: 0, transition: BLOCK_CLOSE }}
              initial={{ height: 0, opacity: 0 }}
              key={folder.path}
              transition={BLOCK_OPEN}
            >
              {/* The margin is what separates the rows, and it sits inside the
                  clip so it collapses with the row rather than leaving a band
                  where one was. Splitting it over both edges also keeps the
                  outlined button off the clip, which took a pixel of its
                  border at any zoom that landed the row on a half pixel. */}
              <div className="my-0.5 flex h-7 items-center gap-2">
                <button
                  className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-foreground/10 hover:opacity-100"
                  onClick={() => {
                    onRemove(folder.path);
                  }}
                  type="button"
                >
                  <XIcon className="size-3" />
                  <span className="sr-only">Remove {name}</span>
                </button>
                <MacFolderIcon className="size-5 shrink-0" />
                <span
                  className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground"
                  title={folder.path}
                >
                  {displayPath(folder.path)}
                </span>
                <FolderAccessControl
                  access={folder.access}
                  folderName={name}
                  onChange={(access) => {
                    onAccessChange(folder.path, access);
                  }}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {showAdd && (
        <Button
          className={cn(
            "w-fit gap-2 border-0 bg-transparent text-xs leading-none shadow-none",
            folders.length > 0 ? "-ml-2.5 h-7 px-2.5" : "-ml-1.5",
          )}
          disabled={disabled}
          onClick={onAdd}
          size="sm"
          variant="outline-muted"
        >
          {folders.length > 0 ? (
            // Same size-4 slot as the remove control so + and × share a
            // keyline. A span, not a bare svg: Button's has-[>svg]:px-*
            // would indent it again.
            <span className="flex size-4 items-center justify-center">
              <PlusIcon className="size-3" />
            </span>
          ) : (
            <FolderIcon className="size-5" />
          )}
          {folders.length > 0
            ? "Add another local folder"
            : "Work in a local folder"}
        </Button>
      )}
    </div>
  );
}
