import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { Button } from "@/client/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { BLOCK_CLOSE, BLOCK_OPEN } from "@/client/lib/motion";
import { displayPath, folderNameFromPath } from "@/client/lib/path-utils";
import { cn, getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type FolderAttachment } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import {
  type Icon,
  LockIcon,
  ShieldWarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment } from "react";
import { toast } from "sonner";

export interface FolderAccess {
  access: FolderAttachment.Access;
  path: string;
}

// Adding a folder is the user asking the agent to work in it, so it starts with
// the access that allows that. The icon, its tooltip and the per-folder control
// are what make the choice legible and reversible.
//
// Deliberately the opposite of the schema's default, which is what an
// attachment carrying no access at all resolves to: that one is about folders
// stored before the choice existed, and has to preserve the posture they were
// attached under. Anything picked here states its access explicitly.
export const DEFAULT_FOLDER_ACCESS: FolderAttachment.Access = "read-write";

const ACCESS_LABELS: Record<FolderAttachment.Access, string> = {
  "read-only": "Read-only",
  "read-write": "Full access",
};

const ACCESS_ICONS: Record<FolderAttachment.Access, Icon> = {
  "read-only": LockIcon,
  "read-write": ShieldWarningIcon,
};

// Full access is stated in one place and shown the same way everywhere it
// applies: the shield, and this sentence on hovering it. Fixed rather than
// counted, because it describes the grant rather than the list it is read
// against.
const FULL_ACCESS_WARNING = `${APP_NAME} will be able to read and write the contents of these folders.`;

// Full access first: it is what a folder is attached with, so the list opens
// with the current choice at the top rather than the way out of it.
const ACCESS_ORDER: FolderAttachment.Access[] = ["read-write", "read-only"];

/**
 * What a folder was granted, and the way to change it.
 *
 * The trigger states the access in an icon and a word; hovering it while the
 * agent can write says what that means. Shared by every surface that grants a
 * folder so the same posture never reads two ways.
 */
export function FolderAccessControl({
  access,
  className,
  folderName,
  onChange,
}: {
  access: FolderAttachment.Access;
  className?: string;
  folderName: string;
  onChange: (access: FolderAttachment.Access) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`Access for ${folderName}`}
              className={cn(
                "h-7 gap-1.5 border-border px-2 text-xs",
                className,
              )}
              variant="outline"
            >
              <FolderAccessIcon access={access} />
              {ACCESS_LABELS[access]}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {/* Below, so what it says about the folder does not cover the prompt
            the folder was attached to. */}
        {access === "read-write" && (
          <TooltipContent side="bottom">{FULL_ACCESS_WARNING}</TooltipContent>
        )}
      </Tooltip>
      <DropdownMenuContent align="end">
        {ACCESS_ORDER.map((value) => {
          const item = (
            <DropdownMenuCheckboxItem
              checked={access === value}
              // The checked row carries the emphasis, so the two read as a
              // current choice and an alternative rather than a pair of options.
              className="data-[state=checked]:text-foreground"
              onSelect={() => {
                onChange(value);
              }}
            >
              <FolderAccessIcon access={value} />
              {ACCESS_LABELS[value]}
            </DropdownMenuCheckboxItem>
          );

          if (value !== "read-write") {
            return <Fragment key={value}>{item}</Fragment>;
          }

          // The row is where the choice is actually made, so what it means has
          // to be readable from here too: whoever opened this menu to find out
          // what full access is should not have to close it again to be told.
          // Beside the menu rather than over it, so the other option stays
          // visible while this one is being read.
          return (
            <Tooltip key={value}>
              <TooltipTrigger asChild>{item}</TooltipTrigger>
              <TooltipContent side="right">
                {FULL_ACCESS_WARNING}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** States the access for a folder the user cannot currently change. */
export function FolderAccessLabel({
  access,
  className,
  iconOnly = false,
}: {
  access: FolderAttachment.Access;
  className?: string;
  iconOnly?: boolean;
}) {
  const label = (
    <span
      aria-label={iconOnly ? ACCESS_LABELS[access] : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground",
        iconOnly && "gap-0 hover:text-muted-foreground",
        className,
      )}
    >
      <FolderAccessIcon
        access={access}
        className={iconOnly ? "size-3.5" : undefined}
      />
      {iconOnly ? null : ACCESS_LABELS[access]}
    </span>
  );

  if (access !== "read-write") {
    return label;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent>{FULL_ACCESS_WARNING}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The folders a task will work in, each with the access it was granted.
 *
 * The full-size arrangement, for a panel with room for it. The composer keeps
 * its own row layout, tight enough to sit under the prompt.
 */
export function FolderAccessList({
  className,
  folders,
  onAccessChange,
  onRemove,
}: {
  className?: string;
  folders: FolderAccess[];
  onAccessChange: (path: string, access: FolderAttachment.Access) => void;
  onRemove: (path: string) => void;
}) {
  if (folders.length === 0) {
    return null;
  }

  return (
    <ul className={cn("flex flex-col", className)}>
      {/* A folder granted here is granted from a panel the user is reading
          rather than a dialog that answers them, so the row it takes opens
          instead of appearing. `initial={false}`: the ones a project already
          had are not arriving. */}
      <AnimatePresence initial={false}>
        {folders.map((folder) => (
          <motion.li
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0, transition: BLOCK_CLOSE }}
            initial={{ height: 0, opacity: 0 }}
            key={folder.path}
            transition={BLOCK_OPEN}
          >
            <FolderAccessRow
              access={folder.access}
              onAccessChange={(access) => {
                onAccessChange(folder.path, access);
              }}
              onRemove={() => {
                onRemove(folder.path);
              }}
              path={folder.path}
            />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** The shield or the lock, at the size every surface shows it. */
function FolderAccessIcon({
  access,
  className,
}: {
  access: FolderAttachment.Access;
  className?: string;
}) {
  const Icon = ACCESS_ICONS[access];

  return <Icon className={cn("size-4", className)} />;
}

function FolderAccessRow({
  access,
  onAccessChange,
  onRemove,
  path,
}: {
  access: FolderAttachment.Access;
  onAccessChange: (access: FolderAttachment.Access) => void;
  onRemove: () => void;
  path: string;
}) {
  const handleReveal = async () => {
    const [error] = await safe(
      rpcClient.utils.showFileInFolder.call({ filepath: path }),
    );
    if (error) {
      toast.error(`Failed to ${getRevealInFolderLabel().toLowerCase()}`, {
        description: error.message,
      });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex items-center gap-x-2.5 px-3 py-1">
          <MacFolderIcon className="size-8 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium">
              {folderNameFromPath(path)}
            </span>
            <span
              className="truncate text-xs font-medium text-muted-foreground"
              title={path}
            >
              {displayPath(path)}
            </span>
          </div>
          <div className="flex items-center gap-x-1.5">
            <FolderAccessControl
              access={access}
              folderName={folderNameFromPath(path)}
              onChange={onAccessChange}
            />
            <button
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-50 hover:bg-foreground/5 hover:opacity-100"
              onClick={onRemove}
              type="button"
            >
              <XIcon className="size-3.5" />
              <span className="sr-only">
                Remove {folderNameFromPath(path)}
              </span>
            </button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void handleReveal()}>
          <RevealInFolderIcon className="size-4" />
          <span>{getRevealInFolderLabel()}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
