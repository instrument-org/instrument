import { filesFolderAtom } from "@/client/atoms/window";
import {
  getGroupTabRouter,
  groupTabRouterIds,
} from "@/client/lib/group-tab-router-registry";
import { moveRouterEntries } from "@/client/lib/tab-router-history";
import { getTabRouters } from "@/client/lib/tab-router-registry";
import { tabsModelAfterMove } from "@/client/lib/tabs-model";
import { rpcClient } from "@/client/rpc/client";
import { movedFilesAddress } from "@/shared/computer-href";
import { useSetAtom } from "jotai";
import { useEffect, useEffectEvent } from "react";

import { appTabsAtom } from "./app-tabs";
import { isInside } from "./host-path";
import { tabsAfterMove } from "./tab-model";
import { useWindowTabsChange } from "./window-tabs";

/** A folder that moved, from where it was to where it is, both on the computer. */
interface FolderMove {
  from: string;
  to: string;
}

/**
 * What a move makes of a tab's address: a Files address standing in the
 * folder or on something inside it names the same thing where the folder
 * is now, and every other address is left as it was.
 */
function addressAfterMove({ from, to }: FolderMove) {
  return (href: string) =>
    movedFilesAddress(href, (hostPath) =>
      isInside(hostPath, from)
        ? `${to}${hostPath.slice(from.length)}`
        : hostPath,
    );
}

/** Hands each folder move to `follow` until `signal` ends the stream. */
async function readMoves(
  signal: AbortSignal,
  follow: (moved: FolderMove) => void,
) {
  try {
    const moves = await rpcClient.workspace.chats.events.folderMoved.call(
      undefined,
      { signal },
    );
    for await (const moved of moves) {
      follow(moved);
    }
  } catch {
    // The window closing ends the stream.
  }
}

/**
 * Takes every tab of the window standing in a chat's own folder along when
 * the folder moves to the chat's title: the chats' tabs and the window's own
 * across its bar, the steps behind and ahead of each, the tabs closed lately,
 * and where Files in the rail goes back to. A tab's router is moved where it
 * stands, so the screen goes on showing what it showed rather than finding
 * it gone; what is kept follows from the routers and is written for the
 * rest. Each window follows for itself, so every window's own tabs follow,
 * and the chats' tabs, which every window keeps, are written by whichever
 * gets there first and found already moved by the rest.
 *
 * A folder renamed in a file manager is no move of the chat's title, and
 * its tabs find their files gone as they would after any rename there.
 */
export function useFollowFolderMoves(isOpen: boolean) {
  const changeTabs = useWindowTabsChange();
  const setAppTabs = useSetAtom(appTabsAtom);
  const setFilesFolder = useSetAtom(filesFolderAtom);
  const follow = useEffectEvent((moved: FolderMove) => {
    const move = addressAfterMove(moved);
    for (const router of getTabRouters().values()) {
      moveRouterEntries(router, move);
    }
    for (const id of groupTabRouterIds()) {
      const router = getGroupTabRouter(id);
      if (router) {
        moveRouterEntries(router, move);
      }
    }
    changeTabs((state) => tabsAfterMove(state, move));
    setAppTabs((model) => tabsModelAfterMove(model, move));
    setFilesFolder((folder) => (folder === null ? null : move(folder)));
  });
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const controller = new AbortController();
    void readMoves(controller.signal, follow);
    return () => {
      controller.abort();
    };
  }, [isOpen]);
}
