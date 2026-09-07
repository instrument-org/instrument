import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";

/** Where a menu was asked for, in window coordinates. */
export interface MenuAt {
  x: number;
  y: number;
}

/**
 * The menu a channel gets on right click.
 *
 * It offers the details dialog and nothing else. Archiving used to be here and
 * is not: it is the most destructive thing a channel can be told, and a menu
 * item beside a harmless one is a slip of the pointer away.
 */
export function ChannelMenu({
  at,
  onClose,
  onOpenDetails,
}: {
  at: MenuAt | undefined;
  onClose: () => void;
  onOpenDetails: () => void;
}) {
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
          style={{ left: at.x, top: at.y }}
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
      </PopoverContent>
    </Popover>
  );
}
