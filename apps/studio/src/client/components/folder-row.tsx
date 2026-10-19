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
import { FolderMark } from "@/client/components/window/folder-mark";
import { nameOf } from "@/client/components/window/host-path";
import { displayPath, folderLabel } from "@/client/lib/path-utils";
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
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
 * A path as a person reads it, from their home folder's own name, cut in the
 * middle when it doesn't fit so where it starts and the folder's own name
 * both stay; the whole of it is the title.
 */
export function FolderPath({
  className,
  path,
}: {
  className?: string;
  path: string;
}) {
  const shown = displayPath(path);
  const name = nameOf(path);
  // The separator before the folder's own name goes with the name, so the
  // ellipsis lands inside the folders above it.
  const cut =
    name && shown.endsWith(name) ? shown.length - name.length - 1 : -1;
  return (
    <span className={cn("flex min-w-0 select-text", className)} title={shown}>
      {cut > 0 ? (
        <>
          <span className="truncate">{shown.slice(0, cut)}</span>
          <span className="shrink-0 whitespace-pre">{shown.slice(cut)}</span>
        </>
      ) : (
        <span className="truncate">{shown}</span>
      )}
    </span>
  );
}

/**
 * A folder wherever a list names one: its mark and its own name over its
 * path, the control the list needs at the end, and one menu that opens it in
 * Files first and copies its path, then whatever the list adds. A row with
 * `onOpen` opens on a click; one without shows Open in Files under the
 * pointer. One with `actions` off is only a picture of the folder, for a
 * dialog asking about it, where the folder may not be there yet.
 */
export function FolderRow({
  actions = true,
  className,
  end,
  menu = [],
  name,
  note,
  onOpen,
  path,
}: {
  actions?: boolean;
  className?: string;
  end?: ReactNode;
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
      <span className="flex w-7 shrink-0 justify-center">
        <FolderMark path={path} size="row" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate text-sm">{label}</span>
        <FolderPath className="text-xs text-muted-foreground" path={path} />
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
