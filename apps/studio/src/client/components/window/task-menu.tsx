import { ShowInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { useCopyChatLocation } from "@/client/components/task/copy-chat-location";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { useTabDeveloperMode } from "@/client/hooks/use-developer-mode";
import { showInFolderLabel, showChatFolder } from "@/client/lib/show-in-files";
import { type StoreId, type ChatId } from "@instrument-org/workspace/client";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";

/**
 * The menu beside a task's name, for what someone looking over its shoulder can
 * do with the run itself rather than with anything in it: open the folder it
 * worked in, or in developer mode copy where its records are.
 */
export function TaskMenu({
  sessionId,
  chatId,
}: {
  /** The session the transcript on screen is showing. */
  sessionId: StoreId.Session | undefined;
  chatId: ChatId;
}) {
  const copyChatLocation = useCopyChatLocation();
  const isDeveloperMode = useTabDeveloperMode();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Task actions"
          className={toolbarClassName({
            className:
              "size-6 shrink-0 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
            pressed: false,
          })}
          size="icon-sm"
          variant="ghost"
        >
          <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom">
        {isDeveloperMode && (
          <DropdownMenuItem
            disabled={!sessionId}
            onSelect={() => {
              if (sessionId) {
                copyChatLocation({ id: chatId, sessionId });
              }
            }}
            variant="developer"
          >
            <CopyIcon className="size-4" />
            Copy chat location
          </DropdownMenuItem>
        )}
        {/* The chat's output folder, where the task's deliverables land. */}
        <DropdownMenuItem
          onSelect={() => {
            void showChatFolder(chatId);
          }}
        >
          <ShowInFolderIcon className="size-4" kind="folder" />
          {showInFolderLabel("folder")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
