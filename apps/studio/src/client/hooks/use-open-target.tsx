import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import { WindowContext } from "@/client/components/window/context";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import {
  copyableOf,
  isWebPage,
  type OpenTarget,
} from "@/client/lib/open-target";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient, type RPCInput } from "@/client/rpc/client";
import { useContext } from "react";
import { toast } from "sonner";

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
      ...(destination.id === "copy" && index > 0 ? [{ separator: true }] : []),
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
    // The first place on the list, which is the app's own wherever the app
    // has one: the OS browser is first only where nothing in the app is.
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
  return isMacOS() ? event.metaKey : event.ctrlKey;
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
 * a window with tabs offers a tab, a surface that says where pages go offers
 * that, and anything drawn outside both offers only the places outside the
 * app.
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
              void navigator.clipboard.writeText(copyable.value).catch(() => {
                toast.error(`Unable to ${copyable.label.toLowerCase()}`);
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
        ...(openPageOnSurface
          ? [
              {
                id: "open" as const,
                label: "Open",
                run: () => {
                  openPageOnSurface(url);
                },
              },
            ]
          : []),
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
        // The default browser only where nothing in the app can open the
        // page: the app's own browser is where a page opens, and its Open in
        // button is the way out of it, so a menu offering both was offering
        // to leave by default.
        ...(openPageOnSurface || appWindow
          ? []
          : [
              {
                id: "openBrowser" as const,
                label: "Open in Default Browser",
                run: () => {
                  openExternalLink(url, { addReferral });
                },
              },
            ]),
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
