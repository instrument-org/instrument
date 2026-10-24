import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { OpenInMenu } from "@/client/components/open-with-menu";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/client/components/ui/context-menu";
import { contextMenuComponents } from "@/client/components/ui/menu-components";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { toast } from "@/client/lib/toast";
import { isMacOS, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { NO_SIDEBAR_CHANGES, pinnedPlaces } from "@/shared/sidebar-places";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { PushPinSlashIcon } from "@phosphor-icons/react/PushPinSlash";
import { useQuery } from "@tanstack/react-query";

import { useWindow } from "./context";

/**
 * What can be done to a place in the sidebar or a part of the address: the
 * folder menu's ways of opening it and pointing at it, and none of the ways
 * of changing it. A place is a folder a person keeps things in, and Rename,
 * Duplicate or the Trash one misplaced click away from the whole of it is not
 * worth the row.
 */
export function PlaceMenu({
  hostPath,
  onNewDraft,
  onOpenInNewTab,
  pin,
}: {
  hostPath: string;
  /** Left out where no draft can be opened. */
  onNewDraft: (() => void) | undefined;
  onOpenInNewTab: () => void;
  /** Pinning it to the sidebar, or unpinning it; left out where neither is offered. */
  pin?: { isPinned: boolean; onToggle: () => void } | undefined;
}) {
  return (
    <ContextMenuContent className="min-w-48">
      {onNewDraft ? (
        <>
          <ContextMenuItem onClick={onNewDraft}>
            <InstrumentGlyph className="size-4 text-brand-600 dark:text-brand-400" />
            <span>Ask</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem onClick={onOpenInNewTab}>
        <NewTabIcon className="size-4" />
        <span>Open in New Tab</span>
      </ContextMenuItem>
      {/* The Open in list already offers the Finder, so a row of its own
          would name it twice. */}
      {isMacOS() ? (
        <OpenInMenu
          file={{ hostPath }}
          menuComponents={contextMenuComponents}
        />
      ) : (
        <ContextMenuItem
          onClick={() =>
            void rpcClient.utils.showFileInFolder
              .call({ filepath: hostPath })
              .catch((error: unknown) => {
                placeActionFailed(
                  `Couldn't show it in ${osConventions().inFileManager}`,
                  error,
                );
              })
          }
        >
          <RevealInFolderIcon className="size-4" />
          <span>{osConventions().showInFileManager}</span>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() =>
          void navigator.clipboard
            .writeText(hostPath)
            .catch((error: unknown) => {
              placeActionFailed("Couldn't copy the path", error);
            })
        }
      >
        <ClipboardTextIcon className="size-4" />
        <span>Copy Path</span>
      </ContextMenuItem>
      {pin ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={pin.onToggle}>
            {pin.isPinned ? (
              <PushPinSlashIcon className="size-4" />
            ) : (
              <PushPinIcon className="size-4" />
            )}
            <span>
              {pin.isPinned ? "Unpin from Sidebar" : "Pin to Sidebar"}
            </span>
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );
}

function placeActionFailed(title: string, error: unknown) {
  toast.error(title, { cause: error });
}

/**
 * What `PlaceMenu` offers for a file or folder of the computer named
 * anywhere outside the folder browser, a part of the address above all: a
 * draft about it, a tab of its own, and for a folder, whether the sidebar
 * lists it. Pinned is read the way the sidebar reads it, the system's own
 * places that are not unpinned and the ones the person pinned.
 */
export function usePlaceMenuProps() {
  const { askAbout, openScreen } = useWindow();
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const preferences = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const sidebarPlaces = preferences.data?.sidebarPlaces ?? NO_SIDEBAR_CHANGES;
  const pinned = pinnedPlaces(
    (places.data?.pinned ?? []).filter((place) => place.kind !== "output"),
    sidebarPlaces,
    (path) => ({ path }),
  );
  return (hostPath: string, kind: "file" | "folder") => {
    const isPinned = pinned.some((place) => place.path === hostPath);
    return {
      hostPath,
      onNewDraft:
        askAbout &&
        (() => {
          askAbout([{ kind, path: hostPath }]);
        }),
      onOpenInNewTab: () => {
        openScreen(
          kind === "folder" ? folderHref(hostPath) : fileHref(hostPath),
          {
            behind: true,
            newTab: true,
          },
        );
      },
      ...(kind === "folder"
        ? {
            pin: {
              isPinned,
              onToggle: () =>
                void (
                  isPinned
                    ? rpcClient.preferences.unpinSidebarPlace
                    : rpcClient.preferences.pinSidebarPlace
                )
                  .call({ path: hostPath })
                  .catch(() => {
                    toast.error("Couldn't change the sidebar");
                  }),
            },
          }
        : {}),
    };
  };
}
