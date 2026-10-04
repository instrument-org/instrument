import { Button } from "@/client/components/ui/button";
import { Kbd } from "@/client/components/ui/kbd";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil";

/**
 * What stands beside the inbox while no chat is open: after one is popped
 * out, closed or deleted, and on arriving at Chat. The inbox keeps its width
 * rather than taking the row, so this is the room a chat would have.
 */
export function NoChatOpen({ onNew }: { onNew: () => void }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center bg-muted/20 px-6 text-center">
      {/* The plate the browser's empty bookmarks shelf draws its mark on,
          alone here and left clear so the pane shows through it, rising into
          place once as the pane appears. Its ring and its mark are one line:
          one color, the ring a step fainter so the mark leads, and the same
          1px, which thin strokes at 8/256 of the icon's size come to at 32px. */}
      <span
        aria-hidden
        className="mb-5 grid size-14 place-items-center rounded-2xl text-muted-foreground/30 shadow-md-soft inset-ring inset-ring-current/60 transition-[translate,opacity] duration-500 ease-out motion-reduce:transition-none starting:translate-y-1 starting:opacity-0"
      >
        <ChatsCircleIcon className="size-8" weight="thin" />
      </span>
      <p className="text-sm font-medium text-muted-foreground">
        No chat selected
      </p>
      <p className="mt-0.5 max-w-72 text-[13px] leading-6 text-muted-foreground/60">
        Select a chat or start a new one
      </p>
      <Button
        className="mt-5 rounded-full has-[>svg]:pr-1.5"
        onClick={() => {
          onNew();
        }}
        size="sm"
        variant="default"
      >
        <NotePencilIcon weight="bold" />
        New chat
        {/* The bookmarks shelf's inset key, tinted rather than filled so it
            reads on the button's own gray in either theme. The button's
            right padding is the gap above and below it (32px less its 20),
            so the key sits evenly in the pill's end. */}
        <Kbd className="ml-0.5 rounded-full bg-black/5 px-1.5 text-[11px] ring-1 ring-black/8 dark:bg-white/10 dark:ring-white/10">
          {formatAccelerator(WINDOW_SHORTCUTS.newChat.accelerator).join("")}
        </Kbd>
      </Button>
    </main>
  );
}
