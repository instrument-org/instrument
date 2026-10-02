import { Button } from "@/client/components/ui/button";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { FeatherIcon } from "@phosphor-icons/react/Feather";

/**
 * What stands beside the inbox while no chat is open: after one is popped
 * out, closed or deleted, and on arriving at Chat. The inbox keeps its width
 * rather than taking the row, so this is the room a chat would have.
 */
export function NoChatOpen({ onNew }: { onNew: () => void }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-muted/20 px-6 text-center">
      <ChatsCircleIcon className="size-10 text-muted-foreground/40" />
      <p className="text-[15px] font-medium">No chat open</p>
      <p className="max-w-72 text-[13px] text-muted-foreground">
        Pick one from the list, or start a new one.
      </p>
      <Button
        className="mt-1 rounded-full"
        onClick={() => {
          onNew();
        }}
        size="sm"
        variant="brand"
      >
        <FeatherIcon weight="bold" />
        New chat
        <span className="ml-0.5 text-[11px] opacity-70">
          {formatAccelerator(WINDOW_SHORTCUTS.newChat.accelerator).join("")}
        </span>
      </Button>
    </main>
  );
}
