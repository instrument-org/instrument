import { type WindowTab } from "@/client/atoms/window";
import { useAddBookmark, useBookmarkActions } from "@/client/bookmarks/actions";
import { addressOfTab } from "@/client/bookmarks/address";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { openPageFind } from "@/client/hooks/use-browser-find";
import {
  openInAppTargetOfUrl,
  useOpenInApp,
} from "@/client/hooks/use-open-in-app";
import { getGuest } from "@/client/lib/browser-pool";
import { revealInFileManager } from "@/client/lib/show-in-files";
import { toast } from "@/client/lib/toast";
import { osConventions } from "@/client/lib/utils";
import { type ShortcutAccelerator } from "@/shared/shortcuts";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { expandHomePath } from "@instrument-org/shared";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PrinterIcon } from "@phosphor-icons/react/Printer";
import { StarIcon } from "@phosphor-icons/react/Star";

import { chatHeadActions, useChatActionsFor } from "./chat-actions";
import { askChatHead } from "./chat-head-requests";
import { type Chat } from "./chats";
import { type RowAction } from "./row-shell";
import { chatOfTab } from "./tab-model";
import { useBookmarkEdits } from "./web-start";
import { matchScreen } from "./window-href";

/** One thing a tab offers, in its own menu and in the command menu alike. */
export type TabAction = RowAction & {
  /** The chord that does the same for the tab up with the keyboard. */
  chord?: ShortcutAccelerator;
};

/**
 * What any tab offers for the address it stands at, in the order its menu
 * lists them: keeping it as a bookmark or no longer, and for a page,
 * reloading it and copying its address. A tab with no address to keep
 * offers none. Answered for any tab by one set of hooks, so a strip asks
 * once and reads each tab's.
 */
export function useTabActionsFor(): (
  tab: WindowTab,
  title: string,
) => TabAction[] {
  const bookmarks = useBookmarkActions();
  const addBookmark = useAddBookmark();
  const bookmarkEdits = useBookmarkEdits();
  return (tab, title) => {
    const address = addressOfTab(tab);
    const kept =
      address === undefined ? undefined : bookmarks.bookmarkOf(address);
    const pageUrl =
      tab.kind === "page" ? (tab.url ?? tab.openedUrl) : undefined;
    return [
      ...(address === undefined
        ? []
        : [
            {
              icon: (
                <StarIcon
                  className="size-4"
                  weight={kept ? "fill" : "regular"}
                />
              ),
              id: "bookmark",
              label: kept ? "Remove from Bookmarks" : "Add to Bookmarks",
              run: () => {
                if (kept) {
                  bookmarkEdits.remove(kept);
                } else {
                  addBookmark({ title, url: address });
                }
              },
            },
          ]),
      ...(pageUrl === undefined
        ? []
        : [
            {
              chord: WINDOW_SHORTCUTS.reloadPage.accelerator,
              icon: <ArrowClockwiseIcon className="size-4" />,
              id: "reload",
              label: "Reload",
              run: () => {
                getGuest(browserTargetOf(tab.id))?.reload();
              },
            },
            {
              icon: <CopyIcon className="size-4" />,
              id: "copy-url",
              label: "Copy URL",
              run: () => {
                void navigator.clipboard.writeText(pageUrl);
              },
            },
          ]),
    ];
  };
}

/** The file a tab shows, by its path on this computer; none for any other tab. */
function fileOfTab(tab: WindowTab): string | undefined {
  if (tab.kind !== "screen") {
    return undefined;
  }
  const screen = matchScreen(tab.href);
  return screen.kind === "computer" && screen.file !== undefined
    ? expandHomePath(screen.file, window.api.homeDir)
    : undefined;
}

/**
 * What the command menu offers for the tab in front, and what that tab is: a
 * chat's own menu (`useChatActionsFor`,
 * `chatHeadActions`), and for a page or a file, the tab's own actions
 * (`useTabActionsFor`) with the ways out of the app its row has. Each is in
 * the order the menu lists them before anything is typed. Nothing for a tab
 * that is none of the three.
 */
export function useFrontTabActions({
  chats,
  tab,
  title,
}: {
  chats: readonly Chat[];
  /** The tab up on the side with the keyboard. */
  tab: undefined | WindowTab;
  /** What the tab is called, which a bookmark of it is named. */
  title: string;
}): undefined | { actions: TabAction[]; kind: "chat" | "file" | "page" } {
  const chatActionsFor = useChatActionsFor();
  const tabActionsFor = useTabActionsFor();
  const pageUrl = tab?.kind === "page" ? (tab.url ?? tab.openedUrl) : undefined;
  const filePath = tab === undefined ? undefined : fileOfTab(tab);
  const openIn = useOpenInApp(
    filePath === undefined
      ? openInAppTargetOfUrl(pageUrl)
      : { hostPath: filePath },
  );
  if (tab === undefined) {
    return undefined;
  }
  const chatId = chatOfTab(tab);
  const chat = chats.find((each) => each.id === chatId);
  if (chat) {
    const ask = (what: Parameters<typeof askChatHead>[1]) => () => {
      askChatHead(tab.id, what);
    };
    const all: TabAction[] = [
      ...chatActionsFor(chat).map((action) =>
        // Archiving puts the chat's tab away, as its own menu's does.
        action.id === "archive"
          ? {
              ...action,
              run: () => {
                action.run();
                askChatHead(tab.id, "archived");
              },
            }
          : action,
      ),
      ...chatHeadActions({
        onDelete: ask("delete"),
        onProject: ask("project"),
        onRename: ask("rename"),
      }),
    ];
    return {
      actions: CHAT_ORDER.flatMap((id) =>
        all.filter((action) => action.id === id),
      ),
      kind: "chat",
    };
  }
  const own = tabActionsFor(tab, title);
  const leave: TabAction = {
    icon: <ArrowSquareOutIcon className="size-4" />,
    id: "open-in-app",
    label: openIn.label,
    run: openIn.open,
  };
  if (filePath !== undefined) {
    return {
      actions: [
        ...own,
        leave,
        {
          icon: <RevealInFolderIcon className="size-4" />,
          id: "show-in-file-manager",
          label: osConventions().showInFileManager,
          run: () => {
            void revealInFileManager(filePath);
          },
        },
        {
          icon: <ClipboardTextIcon className="size-4" />,
          id: "copy-path",
          label: "Copy Path",
          run: () => {
            void navigator.clipboard
              .writeText(filePath)
              .catch((error: unknown) => {
                toast.error("Couldn't copy the path", { cause: error });
              });
          },
        },
      ],
      kind: "file",
    };
  }
  if (pageUrl === undefined || pageUrl === "about:blank") {
    return undefined;
  }
  const targetId = browserTargetOf(tab.id);
  return {
    actions: [
      ...own.filter((action) => action.id !== "reload"),
      ...(openInAppTargetOfUrl(pageUrl) ? [leave] : []),
      ...own.filter((action) => action.id === "reload"),
      {
        chord: WINDOW_SHORTCUTS.findInPage.accelerator,
        icon: <MagnifyingGlassIcon className="size-4" />,
        id: "find",
        label: "Find in Page",
        run: () => {
          openPageFind(targetId);
        },
      },
      {
        chord: WINDOW_SHORTCUTS.printPage.accelerator,
        icon: <PrinterIcon className="size-4" />,
        id: "print",
        label: "Print…",
        run: () => {
          getGuest(targetId)?.print();
        },
      },
    ],
    kind: "page",
  };
}

/**
 * A chat's actions in the order the command menu lists them, the ones
 * reached for most first, since only the first few are listed before
 * anything is typed.
 */
const CHAT_ORDER = [
  "rename",
  "star",
  "unstar",
  "project",
  "archive",
  "unarchive",
  "delete",
  "read",
  "unread",
  "export",
  "feedback",
];
