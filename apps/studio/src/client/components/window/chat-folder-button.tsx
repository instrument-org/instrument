import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { skipToken, useQuery } from "@tanstack/react-query";

import { segmentsOf } from "./host-path";

/**
 * The folders holding files the chat wrote that are still there, by where
 * each is on the computer: empty with no chat and in a chat that has only
 * talked.
 */
export function useChatWrittenFolders(chat: ChatId | undefined): string[] {
  const { data } = useQuery(
    rpcClient.workspace.chats.live.writtenFolders.experimental_liveOptions({
      input: chat === undefined ? skipToken : { id: chat },
    }),
  );
  return data ?? [];
}

/**
 * Opens the folders the chat saved files in beside the chat, lit while the
 * other side shows one of them. With one folder the button opens it or
 * hides it again; with several it opens a menu of them by name.
 */
export function ChatFolderButton({
  folders,
  onHide,
  onOpen,
  shown,
}: {
  folders: readonly string[];
  onHide: () => void;
  onOpen: (folder: string) => void;
  /** The folder the other side shows, when it shows one of `folders`. */
  shown: string | undefined;
}) {
  const [only] = folders;
  const isOpen = shown !== undefined;
  const className = cn(
    "size-7 shrink-0",
    isOpen ? "bg-accent text-foreground" : "text-muted-foreground/70",
  );
  if (only === undefined) {
    return null;
  }
  if (folders.length === 1) {
    const label = isOpen ? "Hide folder" : "Show folder";
    return (
      <ToolbarTooltip label={label}>
        <Button
          aria-label={label}
          aria-pressed={isOpen}
          className={className}
          onClick={() => {
            if (isOpen) {
              onHide();
            } else {
              onOpen(only);
            }
          }}
          size="icon"
          variant="ghost-toolbar"
        >
          <FolderSimpleIcon className="size-4" />
        </Button>
      </ToolbarTooltip>
    );
  }
  const names = folderNames(folders);
  return (
    <DropdownMenu>
      <ToolbarTooltip label="Show a folder">
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Show a folder"
            className={className}
            size="icon"
            variant="ghost-toolbar"
          >
            <FolderSimpleIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent align="end">
        {folders.map((folder, index) => (
          <DropdownMenuItem
            key={folder}
            onSelect={() => {
              onOpen(folder);
            }}
          >
            <FolderSimpleIcon className="size-3.5" />
            <span className="truncate">{names[index]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Each folder by its own name, and by the folder it is in as well where two
 * share a name (`Files/Notes` beside `Projects/Notes`).
 */
function folderNames(folders: readonly string[]): string[] {
  const segments = folders.map((folder) => segmentsOf(folder));
  const last = segments.map((each) => each.at(-1) ?? "");
  return segments.map((each, index) =>
    last.filter((name) => name === last[index]).length > 1
      ? each.slice(-2).join("/")
      : (last[index] ?? ""),
  );
}
