import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { displayPath, folderNameFromPath } from "@/client/lib/path-utils";
import { cn, getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type FolderAttachment } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { EyeIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

export interface FolderAccess {
  access: FolderAttachment.Access;
  path: string;
}

// Adding a folder is the user asking the agent to work in it, so it starts with
// the access that allows that. The warning and the per-folder control are what
// make the choice reversible.
export const DEFAULT_FOLDER_ACCESS: FolderAttachment.Access = "read-write";

const ACCESS_LABELS: Record<FolderAttachment.Access, string> = {
  "read-only": "Read-only",
  "read-write": "Full access",
};

/** Read-only label for a folder the user cannot currently change. */
export function FolderAccessLabel({
  access,
  className,
}: {
  access: FolderAttachment.Access;
  className?: string;
}) {
  return (
    <span className={cn("shrink-0 text-xs text-muted-foreground", className)}>
      {ACCESS_LABELS[access]}
    </span>
  );
}

/**
 * The folders a task will work in, each with the access it was granted.
 *
 * Shared by the prompt composer and the project window so the two never drift;
 * `compact` is the composer's slimmer arrangement, not a different control.
 */
export function FolderAccessList({
  className,
  compact = false,
  folders,
  onAccessChange,
  onRemove,
}: {
  className?: string;
  compact?: boolean;
  folders: FolderAccess[];
  onAccessChange: (path: string, access: FolderAttachment.Access) => void;
  onRemove: (path: string) => void;
}) {
  if (folders.length === 0) {
    return null;
  }

  const writableCount = folders.filter(
    (folder) => folder.access === "read-write",
  ).length;

  return (
    <div className={cn("flex flex-col", className)}>
      {writableCount > 0 && (
        <FolderAccessWarning
          className={compact ? "px-1.5 pt-1 pb-1.5" : "px-3 pb-2"}
          folderCount={writableCount}
          onUseReadOnly={() => {
            for (const folder of folders) {
              if (folder.access === "read-write") {
                onAccessChange(folder.path, "read-only");
              }
            }
          }}
        />
      )}
      <ul className="flex flex-col">
        {folders.map((folder) => (
          <li key={folder.path}>
            <FolderAccessRow
              access={folder.access}
              compact={compact}
              onAccessChange={(access) => {
                onAccessChange(folder.path, access);
              }}
              onRemove={() => {
                onRemove(folder.path);
              }}
              path={folder.path}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The access picker itself, for any row layout that needs one. */
export function FolderAccessSelect({
  access,
  folderName,
  onChange,
}: {
  access: FolderAttachment.Access;
  folderName: string;
  onChange: (access: FolderAttachment.Access) => void;
}) {
  return (
    <Select
      onValueChange={(value) => {
        if (value === "read-only" || value === "read-write") {
          onChange(value);
        }
      }}
      value={access}
    >
      {/* The chevron ships at size-4, which overpowers the 12px label it sits
          beside; the direct-child selector is what beats the utility class the
          primitive puts on it. */}
      <SelectTrigger
        className="h-auto shrink-0 gap-1 border-0 bg-none px-1.5 py-0.5 text-xs shadow-none dark:border-0 dark:bg-transparent dark:hover:bg-muted [&>svg]:size-3.5"
        size="sm"
      >
        <SelectValue />
        <span className="sr-only">Access for {folderName}</span>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="read-write">
          {ACCESS_LABELS["read-write"]}
        </SelectItem>
        <SelectItem value="read-only">{ACCESS_LABELS["read-only"]}</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function FolderAccessWarning({
  className,
  folderCount,
  onUseReadOnly,
}: {
  className?: string;
  folderCount: number;
  onUseReadOnly: () => void;
}) {
  return (
    <div className={cn("flex items-start gap-x-2", className)}>
      <EyeIcon className="mt-px size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        Instrument will be able to read and write the contents of{" "}
        {folderCount === 1 ? "this folder" : "these folders"}.
      </p>
      <button
        className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={onUseReadOnly}
        type="button"
      >
        Use read-only instead
      </button>
    </div>
  );
}

function FolderAccessRow({
  access,
  compact,
  onAccessChange,
  onRemove,
  path,
}: {
  access: FolderAttachment.Access;
  compact: boolean;
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
        <div
          className={cn(
            "group flex items-center gap-x-2",
            compact ? "px-1.5 py-1" : "gap-x-2.5 px-3 py-2",
          )}
        >
          <MacFolderIcon
            className={cn("shrink-0", compact ? "size-5" : "size-8")}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            {!compact && (
              <span className="truncate text-xs font-medium">
                {folderNameFromPath(path)}
              </span>
            )}
            <span
              className="truncate text-xs text-muted-foreground"
              title={path}
            >
              {displayPath(path)}
            </span>
          </div>
          <Select
            onValueChange={(value) => {
              onAccessChange(value as FolderAttachment.Access);
            }}
            value={access}
          >
            {/* The chevron ships at size-4, which overpowers the 12px label it
                sits beside; the direct-child selector is what beats the utility
                class the primitive puts on it. */}
            <SelectTrigger
              className="h-auto shrink-0 gap-1 border-0 bg-none px-1.5 py-0.5 text-xs shadow-none dark:border-0 dark:bg-transparent dark:hover:bg-muted [&>svg]:size-3.5"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="read-write">
                {ACCESS_LABELS["read-write"]}
              </SelectItem>
              <SelectItem value="read-only">
                {ACCESS_LABELS["read-only"]}
              </SelectItem>
            </SelectContent>
          </Select>
          {/* Matched to the select's chevron in size and weight: side by side
              at different weights they read as two competing icons. */}
          <button
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-50 hover:bg-foreground/5 hover:opacity-100"
            onClick={onRemove}
            type="button"
          >
            <XIcon className="size-3.5" />
            <span className="sr-only">Remove {folderNameFromPath(path)}</span>
          </button>
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
