import {
  type FolderAccess,
  FolderAccessControl,
} from "@/client/components/folder-access-list";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { Button } from "@/client/components/ui/button";
import { COMPOSER_CLOSE, COMPOSER_OPEN } from "@/client/lib/composer-motion";
import { displayPath, folderNameFromPath } from "@/client/lib/path-utils";
import { cn } from "@/client/lib/utils";
import { type FolderAttachment } from "@instrument-org/workspace/client";
import { FolderIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
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
    <div className={cn("flex flex-col px-4 py-2", className)}>
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
              exit={{ height: 0, opacity: 0, transition: COMPOSER_CLOSE }}
              initial={{ height: 0, opacity: 0 }}
              key={folder.path}
              transition={COMPOSER_OPEN}
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
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
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
          className="-ml-1.5 h-6 w-fit gap-2 px-1.5 text-xs text-muted-foreground"
          disabled={disabled}
          onClick={onAdd}
          size="sm"
          variant="ghost"
        >
          {folders.length > 0 ? (
            <PlusIcon className="size-3" />
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
