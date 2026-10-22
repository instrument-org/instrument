import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import { WindowContext } from "@/client/components/window/context";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import {
  copyableOf,
  isWebPage,
  type OpenTarget,
} from "@/client/lib/open-target";
import { commandKeyHeld } from "@/client/lib/utils";
import { rpcClient, type RPCInput } from "@/client/rpc/client";
import {
  isFolderPath,
  isInWorkspacePath,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { useContext } from "react";
import { toast } from "@/client/lib/toast";

/**
 * What "copy" puts on the clipboard: for a path a known chat kept, where it
 * is on this computer, found the way the files under a message are, so what
 * is pasted is a path another program can open. The path as named when it
 * names nothing the chat reaches, except a file kept by its place in the
 * workspace (`workspace:/Notes/plan.md`), which is read under the
 * workspace's root whatever chat kept it and fails rather than pasting a
 * name no other program can open.
 */
async function copiedValue(target: OpenTarget, named: string) {
  if (target.kind !== "path") {
    return named;
  }
  const inWorkspace = isInWorkspacePath(named);
  if (target.chatId === undefined && !inWorkspace) {
    return named;
  }
  const filePath = isFolderPath(named) ? named.slice(0, -1) : named;
  const [error, hostPaths] = await safe(
    rpcClient.workspace.chats.files.hostPaths.call({
      chatId: target.chatId ?? WINDOW_ID,
      filePaths: [filePath],
    }),
  );
  const hostPath = error ? undefined : hostPaths[filePath];
  if (hostPath) {
    return hostPath;
  }
  if (inWorkspace) {
    throw error ?? new Error(`No file on this computer at ${named}`);
  }
  return named;
}

/** The middle button, which asks for a place of its own wherever a link is drawn. */
const MIDDLE_BUTTON = 1;

/** One place a target can be opened, as a row of a menu and the thing that row does. */
export interface OpenDestination {
  /** Stable across surfaces, and what the native menu hands back. */
  id: "copy" | "open" | "openBrowser" | "openNewTab";
  label: string;
  run: () => void;
}

/** Raises the destinations as the OS's own menu, and runs what was picked. */
export async function showOpenMenu(destinations: OpenDestination[]) {
  const rows: RPCInput["utils"]["showContextMenu"]["items"] =
    destinations.flatMap((destination, index) => [
      // The places a thing opens, then the clipboard, are two groups.
      ...(destination.id === "copy" && index > 0
        ? [{ separator: true as const }]
        : []),
      { id: destination.id, label: destination.label },
    ]);
  const picked = await rpcClient.utils.showContextMenu.call({ items: rows });
  destinations.find((destination) => destination.id === picked.id)?.run();
}

/** The same gestures, for a list whose rows each name a different target. */
export function useGesturesFor() {
  const destinationsFor = useDestinationsFor();
  return (target: OpenTarget, options?: { addReferral?: boolean }) => {
    const destinations = destinationsFor(target, options);
    // The first place on the list, which is the surface's own wherever it
    // has one: the OS browser is first only where the surface has none.
    const primary = destinations.find(
      (destination) => destination.id !== "copy",
    );
    const separate =
      destinations.find((destination) => destination.id === "openNewTab") ??
      primary;

    const clicks = openClickGestures({
      open: () => primary?.run(),
      openInNewTab: () => (separate ?? primary)?.run(),
    });
    return {
      onAuxClick: clicks.onAuxClick,
      /** A plain click opens where the surface says, and a modified one opens a tab of its own. */
      onClick: (event: React.MouseEvent) => {
        event.preventDefault();
        clicks.onClick(event);
      },
      onContextMenu: (event: React.MouseEvent) => {
        if (destinations.length === 0) {
          return;
        }
        event.preventDefault();
        void showOpenMenu(destinations);
      },
      /** The rows, for a surface that draws its own menu rather than the OS's. */
      destinations,
      /** The same clicks, with the surface's own open on a plain click. */
      opening: (open: () => void) =>
        openClickGestures({
          open,
          openInNewTab: () => (separate ?? primary)?.run(),
        }),
      primary,
      separate,
    };
  };
}

/**
 * The three gestures every openable thing answers, bound once.
 *
 * A plain click opens where the surface says; a middle or modified click asks
 * for a place of its own; a right click raises the whole list in the OS's own
 * menu. Spread onto an anchor, a button, or a row -- what the thing is drawn as
 * is the surface's business, and what a gesture over it means is not.
 *
 * The right-click menu is the OS's rather than one drawn in the page, which is
 * what keeps it identical over a link, a file card and a row of a list, and out
 * of the way of the app's zoom. Refusing the event is also what keeps the
 * generic menu -- "Save Image As" over an icon, and nothing at all over a
 * button -- from answering in its place.
 */
export function useOpenGestures(
  target: OpenTarget,
  options?: { addReferral?: boolean },
) {
  return useGesturesFor()(target, options);
}

/**
 * The clicks every openable row and card answers the same way: a plain click
 * opens it where the surface says, and a Cmd-click (Ctrl off macOS) or a
 * middle click opens it in a tab of its own behind the one up, the way a
 * browser opens a link. For a surface whose own open is not a target's
 * (a chat opened beside the list, a page in the router), spread onto the
 * row alongside its menu's Open in New Tab, which does what these do.
 */
export function openClickGestures({
  open,
  openInNewTab,
}: {
  open: () => void;
  openInNewTab: () => void;
}) {
  return {
    onAuxClick: (event: React.MouseEvent) => {
      if (event.button !== MIDDLE_BUTTON) {
        return;
      }
      // Left alone, Chromium answers a middle click on a link by handing the
      // address to the window, whose open handler sends it out to the OS
      // browser -- the one destination the gesture cannot have meant.
      event.preventDefault();
      openInNewTab();
    },
    onClick: (event: React.MouseEvent) => {
      if (wantsNewTab(event)) {
        openInNewTab();
      } else {
        open();
      }
    },
    /** The middle button's own answer, scrolling, kept from starting over a row it opens. */
    onMouseDown: (event: React.MouseEvent) => {
      if (event.button === MIDDLE_BUTTON) {
        event.preventDefault();
      }
    },
  };
}

/**
 * Whether a click is asking for a place of its own rather than for this one.
 *
 * One modifier, the one the platform means it by: on macOS Ctrl and a click is
 * the secondary click, so answering it with a tab would take the gesture away
 * from the menu it belongs to.
 */
export function wantsNewTab(event: { ctrlKey: boolean; metaKey: boolean }) {
  return commandKeyHeld(event);
}

/**
 * Everywhere this target can be opened from where it is drawn, in the order a
 * menu should list them, the first being what a plain click does.
 *
 * The single answer to "what can be done with this thing", so the menu a right
 * click raises, what a left click does, and what a middle click does are three
 * readings of one list rather than three implementations that drift. A left
 * click never asks: it opens in the app wherever the app has a place, and the
 * OS browser is a row of the menu, chosen on purpose.
 *
 * What is on the list is decided by the surface rather than by the component:
 * a surface that says where pages go opens a page there, anything else
 * (Settings, setup, a dialog) opens it in the OS browser, and a window with
 * tabs also offers a tab of its own.
 *
 * Asked per target, for a list whose rows each name a different one: a row
 * cannot call a hook of its own, so the surface reads what it is once and
 * asks per row. Everything conditional lives past this line.
 */
function useDestinationsFor(): (
  target: OpenTarget,
  options?: { addReferral?: boolean },
) => OpenDestination[] {
  const appWindow = useContext(WindowContext);
  const openPageOnSurface = useContext(PageOpenContext);
  const openPathOnSurface = useContext(FileOpenContext);
  const openExternalLink = useOpenExternalLink();

  return (target, { addReferral = true } = {}) => {
    const copyable = copyableOf(target);
    const copy: OpenDestination[] = copyable
      ? [
          {
            id: "copy",
            label: copyable.label,
            run: () => {
              void copiedValue(target, copyable.value)
                .then((value) => navigator.clipboard.writeText(value))
                .catch((error: unknown) => {
                  toast.error(`Couldn't ${copyable.label.toLowerCase()}`, {
                    cause: error,
                  });
                });
            },
          },
        ]
      : [];

    if (target.kind === "page") {
      const { url } = target;
      // A scheme the OS hands to another program has one destination wherever it
      // is clicked. Offering the app's browser for a `mailto:` would be offering
      // to open a page that does not exist.
      if (!isWebPage(url)) {
        return [
          {
            id: "openBrowser",
            label: "Open",
            run: () => {
              openExternalLink(url, { addReferral });
            },
          },
          ...copy,
        ];
      }
      return [
        // The surface's own place for a page, or the default browser where
        // the surface has none: a page is never opened beside a chat by
        // something that is not that chat's.
        openPageOnSurface
          ? {
              id: "open" as const,
              label: "Open",
              run: () => {
                openPageOnSurface(url);
              },
            }
          : {
              id: "openBrowser" as const,
              label: "Open in Default Browser",
              run: () => {
                openExternalLink(url, { addReferral });
              },
            },
        ...(appWindow
          ? [
              {
                id: "openNewTab" as const,
                label: "Open in New Tab",
                run: () => {
                  appWindow.openPage(url, { behind: true, newTab: true });
                },
              },
            ]
          : []),
        ...copy,
      ];
    }

    if (target.kind === "path") {
      const { path } = target;
      if (!openPathOnSurface) {
        return copy;
      }
      return [
        {
          id: "open",
          label: "Open",
          run: () => {
            openPathOnSurface(path);
          },
        },
        ...(appWindow
          ? [
              {
                id: "openNewTab" as const,
                label: "Open in New Tab",
                run: () => {
                  openPathOnSurface(path, { behind: true, newTab: true });
                },
              },
            ]
          : []),
        ...copy,
      ];
    }

    const { href } = target;
    if (!appWindow) {
      return copy;
    }
    return [
      {
        id: "open",
        label: "Open",
        run: () => {
          appWindow.openScreen(href);
        },
      },
      {
        id: "openNewTab",
        label: "Open in New Tab",
        run: () => {
          appWindow.openScreen(href, { behind: true, newTab: true });
        },
      },
      ...copy,
    ];
  };
}
