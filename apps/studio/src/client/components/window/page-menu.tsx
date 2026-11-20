import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { contextMenuComponents } from "@/client/components/ui/menu-components";
import {
  useGesturesFor,
  wantsNewTab,
  wantsNewWindow,
} from "@/client/hooks/use-open-target";
import { GlobeSimpleIcon } from "@phosphor-icons/react/GlobeSimple";
import { LinkSimpleIcon } from "@phosphor-icons/react/LinkSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { XCircleIcon } from "@phosphor-icons/react/XCircle";
import { type MouseEvent, type ReactElement, useRef } from "react";

import { PlaceItems } from "./place-items";

/** The middle button, which asks for a tab of its own. */
const MIDDLE_BUTTON = 1;

/**
 * What a press on a page kept in a list does: a plain click opens it where
 * the list says, a middle click or a Cmd-click (Ctrl-click off a Mac)
 * opens it in a tab of its own, waiting behind, the way a browser treats its
 * favorites, and a Shift-click in a tab of its own in front.
 */
export function usePageClicks() {
  const gesturesFor = useGesturesFor();
  return (url: string, onOpen: (url: string) => void) => {
    const { destinations, separate } = gesturesFor({ kind: "page", url });
    const inNewTab = destinations.find(
      (destination) => destination.id === "openNewTab",
    );
    return {
      onAuxClick: (event: MouseEvent) => {
        if (event.button !== MIDDLE_BUTTON || !inNewTab) {
          return;
        }
        event.preventDefault();
        separate?.run();
      },
      onClick: (event: MouseEvent) => {
        if (inNewTab && wantsNewWindow(event)) {
          inNewTab.run();
          return;
        }
        if (inNewTab && wantsNewTab(event)) {
          separate?.run();
          return;
        }
        onOpen(url);
      },
      // The middle button's own answer is to scroll; here it opens.
      onMouseDown: (event: MouseEvent) => {
        if (event.button === MIDDLE_BUTTON) {
          event.preventDefault();
        }
      },
    };
  };
}

/**
 * The app's own menu over a page kept in a list (a bookmark, a page lately
 * seen): opening it here or in a place of the window's own
 * (`useWindowPlaces`), its link, and what the list
 * lets be done to its entry. Never the OS browser: the page's own row offers
 * that once it is open.
 */
export function PageContextMenu({
  children,
  onOpen,
  onRemove,
  onRename,
  removeLabel,
  url,
}: {
  /** The row, which the menu comes up over. */
  children: ReactElement;
  onOpen: (url: string) => void;
  /** Takes the entry off the list; left out where it cannot be. */
  onRemove?: () => void;
  /** Starts naming the entry, once the menu has let go of the keyboard. */
  onRename?: () => void;
  removeLabel?: string;
  url: string;
}) {
  const gesturesFor = useGesturesFor();
  const { destinations } = gesturesFor({ kind: "page", url });
  const places = destinations.filter(
    (destination) =>
      destination.id === "openSplit" ||
      destination.id === "openNewTab" ||
      destination.id === "openNewGroup" ||
      destination.id === "openNewWindow",
  );
  const copy = destinations.find((destination) => destination.id === "copy");
  // A rename asked for is started as the menu closes: a field focused while
  // the menu still holds the keyboard loses it at once.
  const renaming = useRef(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-48"
        onCloseAutoFocus={(event) => {
          if (renaming.current) {
            renaming.current = false;
            event.preventDefault();
            onRename?.();
          }
        }}
      >
        <ContextMenuItem
          onClick={() => {
            onOpen(url);
          }}
        >
          <GlobeSimpleIcon className="size-4" />
          <span>Open</span>
        </ContextMenuItem>
        <PlaceItems components={contextMenuComponents} destinations={places} />
        <ContextMenuSeparator />
        {onRename && (
          <ContextMenuItem
            onClick={() => {
              renaming.current = true;
            }}
          >
            <PencilSimpleIcon className="size-4" />
            <span>Rename</span>
          </ContextMenuItem>
        )}
        {copy && (
          <ContextMenuItem onClick={copy.run}>
            <LinkSimpleIcon className="size-4" />
            <span>Copy Link</span>
          </ContextMenuItem>
        )}
        {onRemove && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onRemove}>
              <XCircleIcon className="size-4" />
              <span>{removeLabel ?? "Remove"}</span>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
