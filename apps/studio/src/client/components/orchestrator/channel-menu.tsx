import { useTranscriptActions } from "@/client/components/task/transcript-actions";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { useWindowPointStyle } from "@/client/hooks/use-app-zoom";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";

/** Where a menu was asked for, in window coordinates. */
export interface MenuAt {
  x: number;
  y: number;
}

/**
 * The menu a channel gets on right click: its details, and its transcript out
 * of the app.
 *
 * Archiving used to be here and is not: it is the most destructive thing a
 * channel can be told, and a menu item beside a harmless one is a slip of the
 * pointer away.
 */
export function ChannelMenu({
  at,
  channel,
  onClose,
  onOpenDetails,
  taskId,
}: {
  at: MenuAt | undefined;
  /** The channel this was asked for: its session, and the name a saved file takes. */
  channel: { id: StoreId.Session; name: string };
  onClose: () => void;
  onOpenDetails: () => void;
  /** The conversation the channel belongs to, which is the task its session is stored under. */
  taskId: TaskId;
}) {
  const transcript = useTranscriptActions({
    id: taskId,
    label: channel.name,
    sessionId: channel.id,
  });
  // Hooks run whether a menu was asked for or not, so the corner stands in for
  // a press that has not happened; nothing is rendered at it.
  const anchorStyle = useWindowPointStyle(at ?? { x: 0, y: 0 });

  if (!at) {
    return null;
  }
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <PopoverAnchor asChild>
        {/* Radix anchors to an element and a right click has only coordinates,
          so this is the element: one pixel, no ink, where the press was. */}
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={anchorStyle}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-52 p-1"
        role="menu"
        side="right"
      >
        <button
          className="flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
          onClick={() => {
            onOpenDetails();
            onClose();
          }}
          role="menuitem"
          type="button"
        >
          View channel details…
        </button>
        <div aria-hidden className="my-1 h-px bg-border" />
        {/* Saves without opening anything: a channel's transcript is on its
          way somewhere else, and the path lands on the clipboard for it. */}
        <button
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
          onClick={() => {
            transcript.save("markdown");
            onClose();
          }}
          role="menuitem"
          type="button"
        >
          <ArrowLineDownIcon className="size-4 text-muted-foreground" />
          Save transcript
        </button>
      </PopoverContent>
    </Popover>
  );
}
