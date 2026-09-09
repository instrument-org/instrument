import { zoomAtom } from "@/client/atoms/zoom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { useAtomValue } from "jotai";
import { useState } from "react";

// The menu straddles the click rather than hanging below the link, so both
// destinations are a short move from where the pointer already is. Radix
// positions against the trigger's box, so the offsets below are the click's
// position within the link rather than a viewport coordinate. Rects and
// pointer coordinates are on-screen px, the space Radix applies its offsets
// in, while the two constants are the menu's own layout px, which the content
// re-applies the app's CSS zoom to -- so they are scaled by that zoom on the
// way into the offsets.

/** Layout px. `p-1` on the content plus one `py-1.5 text-sm` row, which is what
 *  has to sit above the pointer for the second row to sit below it. */
const FIRST_ROW_HEIGHT = 36;

/** Layout px. `px-3` plus a `size-4` icon: far enough in that the pointer lands
 *  on the row's icon rather than outside its rounded left edge. */
const ICON_COLUMN_WIDTH = 28;

/** The mark each destination wears, in the menu the left click raises. */
const DESTINATION_ICONS = {
  copy: CopyIcon,
  open: GlobeIcon,
  openBrowser: ArrowSquareOutIcon,
  openNewTab: GlobeIcon,
};

/**
 * A link with somewhere to go besides the OS browser.
 *
 * The app's browser is the same guest the agent drives, so a page opened there
 * is a page the agent can be asked about. That is worth a question on every
 * click, and worth asking it without a remembered answer: which one the user
 * wants follows from what they are doing at that moment, not from a setting
 * they picked once.
 *
 * The rows the question offers, the rows the right-click menu offers, and where
 * a middle click lands are one list, read three ways -- see `useOpenGestures`.
 */
export function TaskExternalLink({
  addReferral = true,
  children,
  className,
  href,
  onClick,
  ...rest
}: React.ComponentProps<"a"> & {
  addReferral?: boolean;
  href: string;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState({ align: 0, side: 0 });
  const zoom = useAtomValue(zoomAtom);
  const { destinations, onAuxClick, onContextMenu, separate } = useOpenGestures(
    { kind: "page", url: href },
    { addReferral },
  );

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild>
        {/* eslint-disable-next-line no-restricted-syntax */}
        <a
          {...rest}
          className={cn("cursor-pointer!", className)}
          // A link is draggable by default, and a drag started from the press
          // this refuses is a drag the menu never recovers from.
          draggable={false}
          href={href}
          onAuxClick={onAuxClick}
          onClick={(event) => {
            // The anchor keeps its href so the URL is inspectable and
            // copyable; the navigation it would do belongs to the menu.
            event.preventDefault();
            if (separate && wantsNewTab(event)) {
              separate.run();
              onClick?.(event);
              return;
            }
            setOpen(true);
            onClick?.(event);
          }}
          onContextMenu={onContextMenu}
          onPointerDown={(event) => {
            // The primary button alone. A right click belongs to the menu the
            // OS draws, and refusing its press is what left the link's own text
            // selected under it; a middle click is answered on the release.
            if (event.button !== 0) {
              return;
            }
            // Runs before the trigger's own handler, so the offsets are in
            // place for the menu's first render rather than a frame after it.
            const rect = event.currentTarget.getBoundingClientRect();
            setOffset({
              align: event.clientX - rect.left - ICON_COLUMN_WIDTH * zoom,
              side: event.clientY - rect.bottom - FIRST_ROW_HEIGHT * zoom,
            });

            // Refusing the press is what stops the release that follows from
            // choosing for the user. A menu item turns a release with no press
            // of its own into a click, so that a press-drag-release picks the
            // row it lands on -- and a menu opened on the press puts a row
            // under a pointer that has not moved yet. Opening on the press
            // would answer an ordinary click with the first destination every
            // time. Composed handlers stop at a prevented default, so this
            // also holds the trigger back until the click below.
            event.preventDefault();
          }}
        >
          {children}
        </a>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        alignOffset={offset.align}
        side="bottom"
        sideOffset={offset.side}
      >
        {destinations.map((destination) => {
          const Icon = DESTINATION_ICONS[destination.id];
          return (
            <DropdownMenuItem
              key={destination.id}
              onSelect={() => {
                destination.run();
              }}
            >
              <Icon />
              {destination.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Whether a click is asking for a place of its own rather than for the menu.
 *
 * One modifier, the one the platform means it by: on macOS Ctrl and a click is
 * the secondary click, so answering it with a tab would take the gesture away
 * from the menu it belongs to.
 */
function wantsNewTab(event: { ctrlKey: boolean; metaKey: boolean }) {
  return isMacOS() ? event.metaKey : event.ctrlKey;
}
