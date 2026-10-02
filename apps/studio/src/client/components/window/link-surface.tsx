import {
  type OpenDestination,
  showOpenMenu,
  useGesturesFor,
  wantsNewTab,
} from "@/client/hooks/use-open-target";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type ReactNode, useContext } from "react";
import { toast } from "sonner";

import { type OpenOptions, WindowContext } from "./context";
import { type LinkTarget, linkTargetOf } from "./link-address";
import { setMenuLink } from "./menu-link";

/** The middle button, which asks for a place of its own. */
const MIDDLE_BUTTON = 1;

/**
 * Keeps every plain link drawn inside it in the app: an anchor no component
 * answered for itself (a link in a Markdown file's editor, one in rendered
 * HTML) opens where the surface opens things rather than leaving the window
 * for the OS browser. A click opens in place, a middle or Cmd-click opens a
 * tab of the window's own, and a right click offers the list, the OS browser
 * one row of it.
 *
 * Inside text being edited a plain click places the caret, and the editor's
 * own menu is the one a right click raises there; only the new-tab gestures
 * are taken.
 *
 * `base` is the folder of the document the links are written in, for the
 * relative ones; `openFile` is where a file goes, for a surface with a place
 * of its own for one (a file tab's tree), and the file's own tab otherwise.
 */
export function LinkSurface({
  base,
  children,
  openFile,
}: {
  base?: string;
  children: ReactNode;
  openFile?: (hostPath: string, options?: OpenOptions) => void;
}) {
  const gesturesFor = useGesturesFor();
  // Absent while the window is still coming up, where a link has nowhere in
  // the window to open and the page's own answer stands.
  const appWindow = useContext(WindowContext);
  const showFile = (hostPath: string, options?: OpenOptions) => {
    if (openFile) {
      openFile(hostPath, options);
      return;
    }
    appWindow?.openScreen(
      hostPath.endsWith("/")
        ? folderHref(hostPath.slice(0, -1))
        : fileHref(hostPath),
      options,
    );
  };
  const fileDestinations = (hostPath: string): OpenDestination[] => [
    {
      id: "open",
      label: "Open",
      run: () => {
        showFile(hostPath);
      },
    },
    {
      id: "openNewTab",
      label: "Open in New Tab",
      run: () => {
        showFile(hostPath, { behind: true, newTab: true });
      },
    },
    {
      id: "copy",
      label: "Copy Path",
      run: () => {
        void navigator.clipboard.writeText(hostPath).catch(() => {
          toast.error("Unable to copy path");
        });
      },
    },
  ];

  const follow = (target: LinkTarget, gesture: "menu" | "newTab" | "open") => {
    if (target.kind === "none" || target.kind === "stay") {
      return;
    }
    if (target.kind === "file") {
      if (gesture === "menu") {
        void showOpenMenu(fileDestinations(target.path));
      } else {
        showFile(
          target.path,
          gesture === "newTab" ? { behind: true, newTab: true } : undefined,
        );
      }
      return;
    }
    const gestures = gesturesFor(
      target.kind === "page"
        ? { kind: "page", url: target.url }
        : { href: target.href, kind: "screen" },
      { addReferral: false },
    );
    if (gesture === "menu") {
      if (gestures.destinations.length > 0) {
        void showOpenMenu(gestures.destinations);
      }
      return;
    }
    (gesture === "newTab" ? gestures.separate : gestures.primary)?.run();
  };

  const answer = (
    event: React.MouseEvent,
    gesture: "menu" | "newTab" | "open",
  ) => {
    if (
      !appWindow ||
      event.defaultPrevented ||
      !(event.target instanceof Element)
    ) {
      return;
    }
    const anchor = event.target.closest("a[href]");
    if (!anchor) {
      return;
    }
    const target = linkTargetOf(
      anchor.getAttribute("href") ?? "",
      base === undefined ? {} : { base },
    );
    const isEditing = anchor.closest("[contenteditable=true]") !== null;
    if (isEditing && gesture === "menu") {
      // The editor's menu is the native one, which offers the link's rows
      // and hands the pick back here.
      setMenuLink(
        target.kind === "stay" || target.kind === "none"
          ? null
          : ({ newTab }) => {
              follow(target, newTab ? "newTab" : "open");
            },
      );
      return;
    }
    if (isEditing && gesture !== "newTab") {
      return;
    }
    if (target.kind === "stay") {
      return;
    }
    event.preventDefault();
    follow(target, gesture);
  };

  return (
    <div
      className="contents"
      onAuxClick={(event) => {
        if (event.button === MIDDLE_BUTTON) {
          answer(event, "newTab");
        }
      }}
      onClick={(event) => {
        answer(event, wantsNewTab(event) ? "newTab" : "open");
      }}
      onContextMenu={(event) => {
        answer(event, "menu");
      }}
    >
      {children}
    </div>
  );
}
