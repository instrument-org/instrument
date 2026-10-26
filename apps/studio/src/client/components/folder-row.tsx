import { ShowInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { Button } from "@/client/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { FolderTrail } from "@/client/components/folder-trail";
import { FolderMark } from "@/client/components/window/folder-mark";
import { folderLabel } from "@/client/lib/path-utils";
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { ArrowElbowDownRightIcon } from "@phosphor-icons/react/ArrowElbowDownRight";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { type ReactNode } from "react";

/** A row a list adds to a folder's menu, after the ones every folder has. */
export type FolderMenuItem = {
  destructive?: boolean;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
};

/** Puts the folder's real path on the clipboard, the one a person pastes into a terminal or a message. */
export async function copyFolderPath(hostPath: string) {
  try {
    await navigator.clipboard.writeText(hostPath);
  } catch (error) {
    toast.error("Couldn't copy the path", { cause: error });
  }
}

/**
 * A folder wherever a list names one: its mark and its own name over its
 * path, the control the list needs at the end, and one menu that opens it in
 * Files first and copies its path, then whatever the list adds. A row with
 * `onOpen` opens on a click; one without shows Open in Files under the
 * pointer. One with `actions` off is only a picture of the folder, for a
 * dialog asking about it, where the folder may not be there yet. A place
 * that is more than one folder, or that names itself, passes its own `mark`
 * and `line`; `indent` sets a folder under the place it is in.
 */
export function FolderRow({
  actions = true,
  className,
  end,
  indent = false,
  line,
  mark,
  menu = [],
  name,
  note,
  onOpen,
  path,
}: {
  actions?: boolean;
  className?: string;
  end?: ReactNode;
  indent?: boolean;
  /** What stands under the name in place of the path; null for nothing. */
  line?: ReactNode;
  mark?: ReactNode;
  menu?: FolderMenuItem[];
  name?: string;
  /** A line under the path, for what the list has to say about this folder. */
  note?: ReactNode;
  onOpen?: (event: { ctrlKey: boolean; metaKey: boolean }) => void;
  path: string;
}) {
  const label = name ?? folderLabel(path);
  const openInFiles = () => {
    void showInFolder(path, { kind: "folder" });
  };
  const body = (
    <>
      {indent ? (
        <ArrowElbowDownRightIcon className="-mr-1 ml-4 size-3.5 shrink-0 text-muted-foreground/60" />
      ) : null}
      <span className="flex w-7 shrink-0 justify-center">
        {mark ?? <FolderMark path={path} size="row" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate text-sm">{label}</span>
        {line === undefined ? (
          <FolderTrail className="text-xs text-muted-foreground" path={path} />
        ) : line === null ? null : (
          <span className="truncate text-xs text-muted-foreground">{line}</span>
        )}
        {note ? (
          <span className="text-xs text-muted-foreground">{note}</span>
        ) : null}
      </span>
    </>
  );
  if (!actions) {
    return (
      <div className={cn("flex min-w-0 items-center gap-3 p-3", className)}>
        {body}
        {end}
      </div>
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group/folder-row flex min-w-0 items-center gap-3 p-3",
            className,
          )}
        >
          {onOpen ? (
            <button
              className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
              onClick={onOpen}
              type="button"
            >
              {body}
            </button>
          ) : (
            <>
              {body}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={`${showInFolderLabel("folder")}: ${label}`}
                    className="opacity-0 group-hover/folder-row:opacity-100 focus-visible:opacity-100"
                    onClick={openInFiles}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <ShowInFolderIcon className="size-4" kind="folder" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showInFolderLabel("folder")}</TooltipContent>
              </Tooltip>
            </>
          )}
          {end}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={openInFiles}>
          <ShowInFolderIcon className="size-4" kind="folder" />
          <span>{showInFolderLabel("folder")}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void copyFolderPath(path)}>
          <ClipboardTextIcon className="size-4" />
          <span>Copy Path</span>
        </ContextMenuItem>
        {menu.length > 0 ? <ContextMenuSeparator /> : null}
        {menu.map((item) => (
          <ContextMenuItem
            key={item.label}
            onClick={item.onSelect}
            variant={item.destructive ? "destructive" : "default"}
          >
            {item.icon}
            <span>{item.label}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
