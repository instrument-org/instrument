import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { skipToken, useQuery } from "@tanstack/react-query";

/**
 * The chat's own folder while it has files in it beside its `CHAT.md`, and
 * null otherwise: with no chat, in a chat that has only talked, and in a
 * workspace whose chats keep no folder of their own.
 */
export function useChatFolderWithFiles(
  chat: ChatId | undefined,
): null | string {
  const { data } = useQuery(
    rpcClient.workspace.chats.live.folderWithFiles.experimental_liveOptions({
      input: chat === undefined ? skipToken : { id: chat },
    }),
  );
  return data ?? null;
}

/** Opens the chat's folder in the pane beside it, lit while the pane shows it. */
export function ChatFolderButton({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = isOpen ? "Hide chat folder" : "Show chat folder";
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={isOpen}
        className={cn(
          "size-7 shrink-0",
          isOpen ? "bg-accent text-foreground" : "text-muted-foreground/70",
        )}
        onClick={onToggle}
        size="icon"
        variant="ghost-toolbar"
      >
        <FolderSimpleIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}
