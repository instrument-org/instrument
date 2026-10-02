import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { useGesturesFor, wantsNewTab } from "@/client/hooks/use-open-target";
import { GlobeSimpleIcon } from "@phosphor-icons/react/GlobeSimple";
import { LinkSimpleIcon } from "@phosphor-icons/react/LinkSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { XCircleIcon } from "@phosphor-icons/react/XCircle";
import { type MouseEvent, type ReactElement, useRef } from "react";

/** The middle button, which asks for a tab of its own. */
const MIDDLE_BUTTON = 1;

/**
 * What a press on a page kept in a list does: a plain click opens it where
 * the list says, and a middle click or a Cmd-click (Ctrl-click off a Mac)
 * opens it in a tab of its own, waiting behind, the way a browser treats its
 * favorites.
 */
export function usePageClicks() {
  const gesturesFor = useGesturesFor();
  return (url: string, onOpen: (url: string) => void) => {
    const inNewTab = gesturesFor({ kind: "page", url }).destinations.find(
      (destination) => destination.id === "openNewTab",
    );
    return {
      onAuxClick: (event: MouseEvent) => {
        if (event.button !== MIDDLE_BUTTON || !inNewTab) {
          return;
        }
        event.preventDefault();
        inNewTab.run();
      },
      onClick: (event: MouseEvent) => {
        if (inNewTab && wantsNewTab(event)) {
          inNewTab.run();
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
 * seen): opening it here or in a tab of its own, its link, and what the list
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
  const inNewTab = destinations.find(
    (destination) => destination.id === "openNewTab",
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
        {inNewTab && (
          <ContextMenuItem onClick={inNewTab.run}>
            <NewTabIcon className="size-4" />
            <span>Open in New Tab</span>
          </ContextMenuItem>
        )}
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
