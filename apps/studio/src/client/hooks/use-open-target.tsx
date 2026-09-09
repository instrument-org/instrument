import { FileOpenContext } from "@/client/components/file-open-context";
import { OrchestratorContext } from "@/client/components/orchestrator/context";
import { PageOpenContext } from "@/client/components/page-open-context";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { useOpenInTaskBrowser } from "@/client/hooks/use-open-in-task-browser";
import { useTaskSession } from "@/client/hooks/use-task-session";
import {
  copyableOf,
  isWebPage,
  type OpenTarget,
} from "@/client/lib/open-target";
import { rpcClient, type RPCInput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
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

/**
 * The same answer, for a list whose rows each name a different target.
 *
 * A row cannot call a hook of its own, so the surface reads what it is once and
 * asks per row. Everything conditional lives past this line.
 */
export function useDestinationsFor(): (
  target: OpenTarget,
  options?: { addReferral?: boolean },
) => OpenDestination[] {
  const orchestrator = useContext(OrchestratorContext);
  const openPageOnSurface = useContext(PageOpenContext);
  const openPathOnSurface = useContext(FileOpenContext);
  const session = useTaskSession();
  const openExternalLink = useOpenExternalLink();
  // Given no task, this reaches the surface's own opener or does nothing; the
  // list below is what decides whether it is offered at all.
  const openInTaskBrowser = useOpenInTaskBrowser({
    sessionId: session.sessionId,
    taskId: session.taskId,
  });

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
      const canOpenHere = Boolean(openPageOnSurface ?? session.taskId);
      return [
        ...(canOpenHere
          ? [
              {
                id: "open" as const,
                label: `Open in ${APP_NAME}`,
                run: () => {
                  openInTaskBrowser(url);
                },
              },
            ]
          : []),
        ...(orchestrator && !orchestrator.opensNewTab
          ? [
              {
                id: "openNewTab" as const,
                label: "Open in New Tab",
                run: () => {
                  orchestrator.openPage(url, { newTab: true });
                },
              },
            ]
          : []),
        {
          id: "openBrowser",
          label: "Open in your browser",
          run: () => {
            openExternalLink(url, { addReferral });
          },
        },
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
        ...(orchestrator && !orchestrator.opensNewTab
          ? [
              {
                id: "openNewTab" as const,
                label: "Open in New Tab",
                run: () => {
                  openPathOnSurface(path, { newTab: true });
                },
              },
            ]
          : []),
        ...copy,
      ];
    }

    const { href } = target;
    if (!orchestrator) {
      return [];
    }
    return [
      {
        id: "open",
        label: "Open",
        run: () => {
          orchestrator.openScreen(href);
        },
      },
      ...(orchestrator.opensNewTab
        ? []
        : [
            {
              id: "openNewTab" as const,
              label: "Open in New Tab",
              run: () => {
                orchestrator.openScreen(href, { newTab: true });
              },
            },
          ]),
    ];
  };
}

/** The same gestures, for a list whose rows each name a different target. */
export function useGesturesFor() {
  const destinationsFor = useDestinationsFor();
  return (target: OpenTarget, options?: { addReferral?: boolean }) => {
    const destinations = destinationsFor(target, options);
    const primary = destinations.find(
      (destination) => destination.id === "open",
    );
    const separate =
      destinations.find((destination) => destination.id === "openNewTab") ??
      primary;

    return {
      onAuxClick: (event: React.MouseEvent) => {
        if (event.button !== MIDDLE_BUTTON || !separate) {
          return;
        }
        // Left alone, Chromium answers a middle click by handing the address to
        // the window, whose open handler sends it out to the OS browser -- the
        // one destination the gesture cannot have meant.
        event.preventDefault();
        separate.run();
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
      separate,
    };
  };
}

/**
 * Everywhere this target can be opened from where it is drawn, in the order a
 * menu should list them, the first being what a plain click does.
 *
 * The single answer to "what can be done with this thing", so the menu a right
 * click raises, the menu a left click raises on a link, and what a middle click
 * does are three readings of one list rather than three implementations that
 * drift. What is on the list is decided by the surface rather than by the
 * component: a window with tabs offers a tab, a task offers its browser, and
 * anything drawn outside both offers only the places outside the app.
 */
export function useOpenDestinations(
  target: OpenTarget,
  options?: { addReferral?: boolean },
): OpenDestination[] {
  return useDestinationsFor()(target, options);
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
