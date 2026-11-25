// turn end, regenerating: apps/studio/src/client/components/**/*.tsx, packages/workspace/system-skills/instrument-guide/places.md
import { applyBookmarkOpsAtom } from "@/client/bookmarks/store";
import { BranchFromReply } from "@/client/components/branch-from-reply";
import { FileActionsMenuItems } from "@/client/components/file-actions-menu";
import { PromptInput } from "@/client/components/prompt-input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
} from "@/client/components/ui/menu-components";
import {
  AppContextMenu,
  AppMenuButton,
} from "@/client/components/window/app-menu";
import { BookmarksBar } from "@/client/components/window/bookmarks-bar";
import { BrowserDownloadsButton } from "@/client/components/window/browser-downloads";
import { BrowserPageMenu } from "@/client/components/window/browser-page-menu";
import { useChatActionsFor } from "@/client/components/window/chat-actions";
import { ChatHeader } from "@/client/components/window/chat-header";
import { ChatRow } from "@/client/components/window/chat-row";
import {
  type Chat,
  NO_FILTERS,
  type Project,
} from "@/client/components/window/chats";
import { useCommandMenuRows } from "@/client/components/window/command-menu";
import { FolderMenuItems } from "@/client/components/window/computer-page";
import {
  WindowContext,
  type WindowContextValue,
} from "@/client/components/window/context";
import { FilterHead } from "@/client/components/window/filter-head";
import {
  GroupRow,
  GroupSidebar,
} from "@/client/components/window/group-sidebar";
import { HelpMenu } from "@/client/components/window/help-menu";
import { PageZoomStepper } from "@/client/components/window/page-menu-items";
import { PaneTabs } from "@/client/components/window/pane-tabs";
import { PlaceMenu } from "@/client/components/window/place-menu";
import { ProjectsSection } from "@/client/components/window/projects-section";
import {
  HistoryButton,
  RecentlyClosedMenu,
} from "@/client/components/window/recently-closed-menu";
import {
  ShellContext,
  type WindowShell,
} from "@/client/components/window/shell-context";
import {
  TabMenuAtPoint,
  TabMenuItems,
} from "@/client/components/window/tab-menu-items";
import { WindowSpaceMenu } from "@/client/components/window/window-space-menu";
import { type FileSystemItem } from "@/client/components/extend/file-system";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { APP_PROTOCOL } from "@instrument-org/shared";
import { MessageBubble } from "@/client/components/user-message";
import { renderWithProviders } from "@/tests/render";
import {
  BrowserTargetIdSchema,
  ChatIdSchema,
  StoreId,
} from "@instrument-org/workspace/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ComponentProps, type ReactElement, type ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The part of the product guide skill that is read off the app's own menus
 * and bars: each is rendered as each system has it, and what it offers is
 * written to the skill's `places.md`, so a renamed or added item reaches the
 * agent with the change that makes it. Every name in angle brackets stands
 * for the user's own.
 */

const rpc = vi.hoisted(() => ({
  /** What a query answers, by its route; every other one stays pending. */
  answers: {} as Record<string, unknown>,
  /** The items of the system's own menu a press last raised. */
  native: undefined as { label?: string }[] | undefined,
}));

vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (route: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: (_target, _this, args: { items?: { label?: string }[] }[]) => {
        if (route.join(".") === "utils.showContextMenu.call") {
          rpc.native = args[0]?.items;
        }
        return pending();
      },
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          const answer = rpc.answers[route.join(".")];
          return () => ({
            ...(answer === undefined ? {} : { initialData: answer }),
            queryFn: pending,
            queryKey: route,
          });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({ mutationFn: pending, ...options });
        }
        return typeof key === "string" ? procedure([...route, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ setTheme: () => undefined, theme: "system" }),
}));

const none = () => undefined;

/** A project's mark, which is no part of its name. */
const MARK = "◦";
const PROJECT: Project = {
  color: "#0f9d6e",
  created: new Date(1),
  emoji: MARK,
  id: "project",
  name: "<project>",
};
const CHAT: Chat = {
  archived: false,
  firstAsk: "",
  holds: { apps: [], files: [], sites: [] },
  id: ChatIdSchema.parse("2026-11-14-chat"),
  lastUserMessageAt: 0,
  project: PROJECT.id,
  sessionId: StoreId.newSessionId(),
  starred: false,
  status: "working",
  title: "<chat>",
  titleByApp: true,
  unread: false,
  unreadByUser: false,
  working: true,
};
const PAGE = {
  group: "group",
  id: "tab-page",
  kind: "page",
  openedAt: 0,
  title: "<page>",
  url: "https://example.com",
} as const;
const TARGET = BrowserTargetIdSchema.parse("tab_01M7EKJA7JST69N0RVMKWTP7Q8");
const FILE: FileSystemItem = {
  kind: "file",
  metadata: { hostPath: "/Users/mac-user/Documents/<file>" },
  path: "Documents/<file>",
};
const FOLDER: FileSystemItem = {
  kind: "folder",
  metadata: { hostPath: "/Users/mac-user/Documents/<folder>" },
  path: "Documents/<folder>/",
};
const FILE_ACTIONS = {
  menuComponents: contextMenuComponents,
  onAddToBookmarks: none,
  onCopy: none,
  onCopyPath: none,
  onCut: none,
  onDuplicate: none,
  onInfo: none,
  onNewFolder: none,
  onOpen: none,
  onOpenInNewGroup: none,
  onOpenInNewTab: none,
  onOpenInNewWindow: none,
  onOpenInSplit: none,
  onQuickLook: none,
  onRename: none,
  onReveal: none,
  onTrash: none,
  paste: { into: "<folder>", onMove: none, onPaste: none },
} satisfies Omit<ComponentProps<typeof FolderMenuItems>, "item">;
const TAB_ACTIONS = {
  actions: [],
  components: dropdownMenuComponents,
  isSelected: true,
  onClose: none,
  onCloseOthers: none,
  onCloseSplit: none,
  onCloseToLeft: none,
  onCloseToRight: none,
  onDuplicate: none,
  onJoinSides: none,
  onMoveToNewGroup: none,
  onMoveToNewWindow: none,
  onMoveToOtherSide: none,
  onNewChatInSplit: none,
  onOpenInSplit: none,
} satisfies ComponentProps<typeof TabMenuItems>;
// Only what the menus read of an app is here.
const APP = {
  hasCredential: true,
  name: "<app>",
  service: "app",
  slug: "app",
  status: "connected",
  type: "mcp",
} as ComponentProps<typeof AppMenuButton>["app"];

rpc.answers["apps.live.catalog"] = [{ name: "<app>", slug: "app" }];
rpc.answers["browser.live.downloads"] = [
  {
    exists: true,
    filename: "<file>",
    id: "download",
    path: "/Users/mac-user/Downloads/<file>",
    receivedBytes: 1,
    state: "completed",
    totalBytes: 1,
    url: PAGE.url,
  },
];
rpc.answers["files.clipboardHasFiles"] = { hasFiles: true };
rpc.answers["user.live.me"] = null;
rpc.answers["workspace.skill.list"] = [
  { id: "skill", name: "<skill>", userInvocable: true },
];
rpc.answers["window.live.others"] = [{ id: "other", title: "<window>" }];

/** Rows that stand for a list the user's own things fill. */
const LISTS: Record<string, string> = {
  "Loading apps…": "<apps that open it>",
  "No closed tabs": "<tabs and groups closed lately>",
  "No pages yet": "<recent pages>",
};

/** One thing a place offers: its words, the keys beside it, and a submenu's groups. */
type Offer = { keys: string; label: string; under: Offer[][] };

/** The words of a row, without its keys, and those apart. */
function offerOf(element: HTMLElement): Offer {
  const copy = element.cloneNode(true);
  if (!(copy instanceof HTMLElement)) {
    throw new TypeError("not an element");
  }
  const keys = copy.querySelector(
    '[data-slot$="shortcut"],[data-slot="soft-key"]',
  );
  keys?.remove();
  // A second line or a size beside the name is a part of its own.
  const parts = [...copy.querySelectorAll("*")]
    .flatMap(({ childNodes }) => [...childNodes])
    .concat([...copy.childNodes])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .toSorted((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  const words: string[] = [];
  let from: Node | null = null;
  for (const part of parts) {
    const text = part.textContent?.replace(MARK, "") ?? "";
    if (text.trim() !== "") {
      // Text beside text, a name set into a line, is one part.
      if (from === part.parentNode && words.length > 0) {
        words.push(`${words.pop() ?? ""}${text}`);
      } else {
        words.push(text);
      }
      from = part.parentNode;
    }
  }
  const [name = "", ...notes] = words.map((each) => each.trim());
  const label =
    element.getAttribute("aria-label") ??
    (notes.length > 0 ? `${name} (${notes.join(", ")})` : name);
  return {
    keys: keys?.textContent ?? "",
    label:
      LISTS[label] ?? (label || (element.getAttribute("placeholder") ?? "")),
    under: [],
  };
}

/** A menu's rows in its groups, each submenu opened and read in turn. */
async function groupsOf(menu: Element, depth = 0): Promise<Offer[][]> {
  const groups: Offer[][] = [[]];
  const parts = menu.querySelectorAll<HTMLElement>(
    '[role^="menuitem"],[role="separator"],button',
  );
  for (const part of parts) {
    if (part.getAttribute("role") === "separator") {
      groups.push([]);
      continue;
    }
    const offer = offerOf(part);
    if (part.getAttribute("aria-haspopup") === "menu" && depth < 2) {
      fireEvent.click(part);
      await act(() => Promise.resolve());
      const sub = document.getElementById(
        part.getAttribute("aria-controls") ?? "",
      );
      if (sub && sub !== menu) {
        offer.under = await groupsOf(sub, depth + 1);
      }
    }
    groups.at(-1)?.push(offer);
  }
  return groups.filter((group) => group.length > 0);
}

/** What the window's own parts read of it: nothing is open, and every act does nothing. */
function standIn<T extends object>(known: Partial<T>): T {
  // Only what the parts under test read is here, the rest answering as an act.
  return new Proxy(known, {
    get: (target, key) => (key in target ? Reflect.get(target, key) : none),
  }) as T;
}
const shell = standIn<WindowShell>({
  chatTitles: new Map([[CHAT.id, CHAT.title]]),
  childTitles: new Map(),
  drafts: [],
  projects: [PROJECT],
});
const appWindow = standIn<WindowContextValue>({
  browser: null,
  chatId: undefined,
});

function show(children: ReactNode) {
  return renderWithProviders(
    <ShellContext.Provider value={shell}>
      <WindowContext.Provider value={appWindow}>
        {children}
      </WindowContext.Provider>
    </ShellContext.Provider>,
  );
}

const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function menuUp() {
  await settle();
  const menu = document.querySelector('[role="menu"]');
  if (!menu) {
    throw new Error("no menu came up");
  }
  return groupsOf(menu);
}

/** The menu a button opens. */
async function menuOf(name: RegExp | string) {
  const [button] = screen.getAllByRole("button", { name });
  if (!button) {
    throw new Error(`no button ${name.toString()}`);
  }
  fireEvent.keyDown(button, { key: "Enter" });
  return menuUp();
}

/** The menu a right-click raises, the app's or the system's. */
async function rightClick(target: HTMLElement) {
  rpc.native = undefined;
  fireEvent.contextMenu(target);
  // Set by the press, which the compiler cannot see.
  const native = rpc.native as { label?: string }[] | undefined;
  if (native) {
    return [
      native.flatMap(({ label }) =>
        label === undefined ? [] : [{ keys: "", label, under: [] }],
      ),
    ];
  }
  return menuUp();
}

/** Every control on screen, the ones that show only on pointing included. */
function controls() {
  const seen = new Set<string>();
  const offers = [
    ...document.querySelectorAll<HTMLElement>(
      'button,input:not([type="file"],[type="checkbox"]),[role="textbox"],[role="combobox"]:not(input)',
    ),
  ].flatMap((element) => {
    const offer =
      element.getAttribute("role") === "switch"
        ? offerOf(element.closest("label") ?? element)
        : offerOf(element);
    if (offer.label === "" || seen.has(offer.label)) {
      return [];
    }
    seen.add(offer.label);
    return [offer];
  });
  return [offers];
}

/** A menu raised over a stand-in row. */
async function contextMenuOf(content: ReactElement) {
  show(
    <ContextMenu>
      <ContextMenuTrigger>
        <p>here</p>
      </ContextMenuTrigger>
      {content}
    </ContextMenu>,
  );
  return rightClick(screen.getByText("here"));
}
const rowsMenu = (rows: ReactNode) =>
  contextMenuOf(<ContextMenuContent>{rows}</ContextMenuContent>);

async function tabMenu(props: Partial<ComponentProps<typeof TabMenuItems>>) {
  show(
    <TabMenuAtPoint at={{ x: 0, y: 0 }} onDismiss={none}>
      <TabMenuItems {...TAB_ACTIONS} {...props} />
    </TabMenuAtPoint>,
  );
  return menuUp();
}

function strip() {
  show(
    <PaneTabs
      chatTitles={new Map([[CHAT.id, CHAT.title]])}
      chosenId={PAGE.id}
      onClose={none}
      onDuplicate={none}
      onNew={none}
      onSelect={none}
      tabs={[PAGE]}
      taskTitles={new Map()}
    />,
  );
}

function Row() {
  const actionsFor = useChatActionsFor();
  return (
    <ChatRow
      actions={actionsFor(CHAT)}
      appsBySlug={new Map()}
      chat={CHAT}
      isOpen={false}
      now={new Date(0)}
      onDelete={none}
      onNewProject={none}
      onOpen={none}
      onSetProject={none}
      projects={[PROJECT]}
    />
  );
}

function Commands({ words }: { words: string }) {
  const { rows } = useCommandMenuRows({
    active: true,
    done: (run) => run,
    openPage: none,
    openScreen: none,
    showTab: none,
    words,
  });
  const from = rows.findIndex(
    (row) => row.type === "header" && row.label === "Commands",
  );
  const section = from === -1 ? [] : rows.slice(from + 1);
  const end = section.findIndex((row) => row.type === "header");
  return section
    .slice(0, end === -1 ? undefined : end)
    .map((row) =>
      row.type === "item" ? <button key={row.id}>{row.label}</button> : null,
    );
}

function LinkMenu() {
  const { destinations } = useGesturesFor()({ kind: "page", url: PAGE.url });
  return destinations.map(({ id, label }) => <button key={id}>{label}</button>);
}

function chatHead() {
  show(
    <ChatHeader
      chat={CHAT}
      onDeleted={none}
      onNewProject={none}
      onOpenPage={none}
      onSetProject={none}
      projects={[PROJECT]}
    />,
  );
}

function bar() {
  const { store } = show(
    <BookmarksBar files={{ group: "group" }} isAlwaysShown onOpen={none} />,
  );
  act(() => {
    void store.set(applyBookmarkOpsAtom, [
      {
        folder: { id: "folder", order: 1, title: "<folder>" },
        type: "addFolder",
      },
      {
        bookmark: {
          id: "bookmark",
          order: 2,
          title: "<bookmark>",
          url: PAGE.url,
        },
        type: "add",
      },
    ]);
  });
}

function projects() {
  show(
    <ProjectsSection
      chats={[]}
      onChoose={none}
      onDetails={none}
      onNew={none}
      projects={[PROJECT]}
    />,
  );
}

/** Each place, by section: how it is reached, then what reads it. */
const SECTIONS: {
  places: [reach: string, read: () => Promise<Offer[][]> | Offer[][]][];
  title: string;
}[] = [
  {
    places: [
      [
        "Top to bottom",
        () => {
          show(
            <GroupSidebar
              chatTitles={new Map()}
              groupUp={undefined}
              onClose={none}
              onCloseAll={none}
              onDuplicate={none}
              onNew={none}
              onNewProject={none}
              onPin={none}
              onReopenLast={none}
              onShow={none}
              open={[]}
              projects={[PROJECT]}
            />,
          );
          return controls();
        },
      ],
      [
        "Right-click a tab group",
        () => {
          show(
            <GroupRow
              chatTitles={new Map()}
              entry={{
                group: "group",
                kind: "tabs",
                pinned: false,
                title: "<group>",
              }}
              isUp={false}
              menu={{
                isPinned: false,
                onClose: none,
                onCloseAbove: none,
                onCloseBelow: none,
                onCloseOthers: none,
                onDuplicate: none,
                onNewWindow: none,
                onTogglePin: none,
              }}
            />,
          );
          return rightClick(screen.getByRole("button"));
        },
      ],
      [
        "Right-click the empty space",
        () => {
          show(
            <TabMenuAtPoint at={{ x: 0, y: 0 }} onDismiss={none}>
              <WindowSpaceMenu kind="group" onNew={none} onReopenLast={none} />
            </TabMenuAtPoint>,
          );
          return menuUp();
        },
      ],
      [
        "Right-click a project, or its ⋯",
        () => {
          projects();
          return menuOf(/^Actions for/);
        },
      ],
      [
        "Right-click the Projects heading",
        () => {
          projects();
          return rightClick(screen.getByRole("button", { name: "Projects" }));
        },
      ],
      [
        "History button",
        () => {
          show(<HistoryButton />);
          fireEvent.click(screen.getByRole("button"));
          return [
            [{ keys: "", label: "<tab groups closed lately>", under: [] }],
            ...controls().map((each) => each.slice(1)),
          ];
        },
      ],
      [
        "Help button",
        () => {
          show(<HelpMenu />);
          return menuOf("Help");
        },
      ],
    ],
    title: "Sidebar",
  },
  {
    places: [
      [
        "A side's row of tabs",
        () => {
          strip();
          return controls();
        },
      ],
      [
        "Right-click any tab",
        async () => {
          const alone = await tabMenu({});
          cleanup();
          const several = await tabMenu({
            moveToWindow: {
              onMove: none,
              windows: [{ id: "other", title: "<window>" }],
            },
          });
          cleanup();
          return either(
            either(alone, several),
            await tabMenu({ onMoveToOtherSide: undefined }),
          );
        },
      ],
      [
        "A website's tab also has",
        async () => {
          const every = await tabMenu({});
          cleanup();
          strip();
          return except(await rightClick(screen.getByRole("tab")), every);
        },
      ],
      [
        "Right-click the row's empty space",
        () => {
          show(
            <TabMenuAtPoint at={{ x: 0, y: 0 }} onDismiss={none}>
              <WindowSpaceMenu
                kind="tab"
                onNew={none}
                onReopenLast={none}
                sides={{
                  hasKeyboard: true,
                  onCloseSplit: none,
                  onJoinSides: none,
                  onNewTabInSplit: none,
                }}
              />
            </TabMenuAtPoint>,
          );
          return menuUp();
        },
      ],
      [
        "Right-click the New tab button",
        () => contextMenuOf(<RecentlyClosedMenu />),
      ],
      [
        "Right-click a link in the app's own pages",
        () => {
          show(<LinkMenu />);
          return controls();
        },
      ],
    ],
    title: "Tabs",
  },
  {
    places: [
      [
        "More actions, the ⋮ at the toolbar's right end",
        () => {
          show(
            <BrowserPageMenu
              bookmark={{ canBookmark: true }}
              onOpenHistory={none}
              page={{
                copyUrl: none,
                devTools: none,
                find: none,
                hardReload: none,
                openIn: { url: PAGE.url },
                print: none,
                save: none,
                share: none,
                targetId: TARGET,
              }}
              zoom={<PageZoomStepper onZoom={none} zoom={1} />}
            />,
          );
          return menuOf("More actions");
        },
      ],
      [
        "Downloads, in the toolbar once something was downloaded",
        () => {
          show(
            <BrowserDownloadsButton
              surfaceRef={{ current: null }}
              targetId="tab-page"
            />,
          );
          fireEvent.click(screen.getByRole("button"));
          // The file's own row says its size and site.
          return controls().map((group) =>
            group.filter(({ label }) => !label.startsWith("<file>")),
          );
        },
      ],
    ],
    title: "A website's tab",
  },
  {
    places: [
      [
        "Left to right",
        () => {
          bar();
          return controls();
        },
      ],
      [
        "Right-click the bar",
        () => {
          bar();
          return rightClick(screen.getByRole("toolbar"));
        },
      ],
      [
        "Right-click a bookmark",
        () => {
          bar();
          return rightClick(screen.getByText("<bookmark>"));
        },
      ],
      [
        "Right-click a folder",
        () => {
          bar();
          return rightClick(screen.getByText("<folder>"));
        },
      ],
    ],
    title: "Bookmarks bar",
  },
  {
    places: [
      [
        "Its top",
        () => {
          chatHead();
          return controls();
        },
      ],
      [
        "Its menu, on the caret after the title or a right-click on its tab",
        () => {
          chatHead();
          return menuOf("Chat menu");
        },
      ],
      [
        "On a message of yours, pointing at it",
        () => {
          show(<MessageBubble onEdit={none} text="" tone="you" />);
          return controls();
        },
      ],
      [
        "Under a reply",
        () => {
          show(<BranchFromReply at={undefined} onBranch={pending} text="" />);
          return controls();
        },
      ],
      [
        "Reply box",
        () => {
          show(<Composer />);
          const idle = controls();
          cleanup();
          show(<Composer isWorking />);
          const busy = except(controls(), idle);
          return [
            ...idle,
            ...busy.map((group) =>
              group.map((offer) => ({
                ...offer,
                label: `${offer.label} while it works`,
              })),
            ),
          ];
        },
      ],
      [
        "Reply box's +",
        () => {
          show(<Composer />);
          return menuOf("Add to this prompt");
        },
      ],
    ],
    title: "A chat",
  },
  {
    places: [
      [
        "Top of the page",
        () => {
          show(
            <FilterHead
              chats={[]}
              filters={NO_FILTERS}
              onFiltersChange={none}
              project={undefined}
            />,
          );
          return controls();
        },
      ],
      [
        "View options, at the search's right",
        () => {
          show(
            <FilterHead
              chats={[]}
              filters={NO_FILTERS}
              onFiltersChange={none}
              project={undefined}
            />,
          );
          const before = controls();
          fireEvent.click(screen.getByRole("button", { name: "View options" }));
          return except(controls(), before);
        },
      ],
      [
        "On a chat, pointing at it",
        () => {
          show(<Row />);
          return controls();
        },
      ],
      [
        "Right-click a chat",
        () => {
          show(<Row />);
          return rightClick(screen.getByText(CHAT.title));
        },
      ],
    ],
    title: "Chats page",
  },
  {
    places: [
      [
        "Right-click a file",
        () => rowsMenu(<FolderMenuItems {...FILE_ACTIONS} item={FILE} />),
      ],
      [
        "A folder also has",
        async () => {
          const file = await rowsMenu(
            <FolderMenuItems {...FILE_ACTIONS} item={FILE} />,
          );
          cleanup();
          return except(
            await rowsMenu(
              <FolderMenuItems
                {...FILE_ACTIONS}
                favorite={{ isFavorite: false, onToggle: none }}
                item={FOLDER}
              />,
            ),
            file,
          );
        },
      ],
      [
        "Right-click the empty space",
        () => rowsMenu(<FolderMenuItems {...FILE_ACTIONS} item={undefined} />),
      ],
      [
        "Right-click a place in the sidebar or the address",
        () =>
          contextMenuOf(
            <PlaceMenu
              favorite={{ isFavorite: true, onToggle: none }}
              hostPath="/Users/mac-user/Documents"
              onOpenInNewTab={none}
              onOpenInNewWindow={none}
            />,
          ),
      ],
      [
        "Right-click a file in a chat",
        () =>
          rowsMenu(
            <FileActionsMenuItems
              file={{
                filename: "notes.md",
                hostPath: "/Users/mac-user/notes.md",
                mimeType: "text/markdown",
                url: `${APP_PROTOCOL}://computer/Users/mac-user/notes.md`,
              }}
              menuComponents={contextMenuComponents}
            />,
          ),
      ],
    ],
    title: "Files",
  },
  {
    places: [
      [
        "Right-click an app's tile",
        () => {
          show(
            <AppContextMenu app={APP} name="<app>" onInspect={none} opens={[]}>
              <p>here</p>
            </AppContextMenu>,
          );
          return rightClick(screen.getByText("here"));
        },
      ],
      [
        "⋯ by the app's name on its page",
        () => {
          show(<AppMenuButton app={APP} name="<app>" onInspect={none} />);
          return menuOf(/^More for/);
        },
      ],
      [
        "⋯ on an account's row",
        () => {
          show(<AppMenuButton app={APP} isAccount name="<app>" />);
          return menuOf(/^More for/);
        },
      ],
    ],
    title: "Apps",
  },
  {
    places: [
      [
        "Commands",
        async () => {
          let all: Offer[][] = [[]];
          for (const words of "aeiorstnw") {
            show(<Commands words={words} />);
            await settle();
            all = either(all, controls());
            cleanup();
          }
          return all.map((group) =>
            group
              .filter(({ label }) => !label.startsWith("Search the web"))
              .toSorted((a, b) => a.label.localeCompare(b.label, "en")),
          );
        },
      ],
    ],
    title: "Command menu",
  },
];

const pending = () => new Promise<void>(none);

function Composer({ isWorking = false }: { isWorking?: boolean }) {
  return (
    <PromptInput
      isLoading={false}
      {...(isWorking ? { onStop: none } : {})}
      draftKey={{ id: "composer", scope: "transient" }}
      modelURI={undefined}
      onModelChange={none}
      onSubmit={none}
      placeholder=""
      places={{
        computerName: "<this computer>",
        onOpenApps: none,
        onOpenComputer: none,
        onOpenWeb: none,
      }}
    />
  );
}

/** Two readings of a place as one, each row once, the first's order kept. */
function either(one: Offer[][], other: Offer[][]): Offer[][] {
  const both = one.map((group) => [...group]);
  const known = new Set(one.flat().map(({ label }) => label));
  let at = both[0];
  let index = 0;
  for (const group of other) {
    for (const offer of group) {
      const home = both.find((each) =>
        each.some(({ label }) => label === offer.label),
      );
      if (home) {
        at = home;
        index = home.findIndex(({ label }) => label === offer.label) + 1;
      } else if (!known.has(offer.label)) {
        known.add(offer.label);
        if (at) {
          at.splice(index, 0, offer);
          index += 1;
        } else {
          at = [offer];
          both.push(at);
        }
      }
    }
  }
  return both;
}

/** What a place has beyond another. */
function except(groups: Offer[][], known: Offer[][]): Offer[][] {
  const labels = new Set(known.flat().map(({ label }) => label));
  return groups
    .map((group) => group.filter(({ label }) => !labels.has(label)))
    .filter((group) => group.length > 0);
}

const SYSTEMS = [
  { name: "Mac", platform: "darwin" },
  { name: "Windows", platform: "win32" },
  { name: "Linux", platform: "linux" },
] as const;
type System = (typeof SYSTEMS)[number]["name"];

/** A row as every system has it, or by which systems do. */
function rowText(label: string, per: Map<System, Offer>, all: number): string {
  const mac = per.get("Mac")?.keys ?? "";
  const others = [
    ...new Set(
      (["Windows", "Linux"] as const).flatMap(
        (name) => per.get(name)?.keys ?? [],
      ),
    ),
  ].filter(Boolean);
  const keys = [...new Set([mac, ...others])].filter(Boolean).join(" / ");
  const on = per.size === all ? "" : [...per.keys()].join(" and ");
  const notes = [keys, on && `${on} only`].filter(Boolean).join(", ");
  const under = merged(
    new Map([...per].map(([name, offer]) => [name, offer.under])),
  );
  return `${label}${notes ? ` (${notes})` : ""}${
    under.length > 0 ? ` › [${under.join("; ")}]` : ""
  }`;
}

/** A place's groups across the systems, a line each. */
function merged(readings: Map<System, Offer[][]>): string[] {
  const [first = [], ...rest] = readings.values();
  const groups = rest.reduce(either, first);
  return groups.map((group) =>
    group
      .map(({ label }) => {
        const per = new Map<System, Offer>();
        for (const [name, reading] of readings) {
          const offer = reading.flat().find((each) => each.label === label);
          if (offer) {
            per.set(name, offer);
          }
        }
        return rowText(label, per, readings.size);
      })
      .join(", "),
  );
}

const HEAD = `<!-- Generated by apps/studio/src/client/lib/product-guide-places.test.tsx from the app's own menus and bars. Do not edit by hand: run \`pnpm fix\`. -->

# What each place offers

Read one section, \`sed -n '/^## Tabs/,/^## /p'\` on this file; the sections are SECTIONS. \`;\` parts a menu's groups, \`› [ ]\` is a submenu, keys are the Mac's, then Windows and Linux's, and \`<words>\` stand for the user's own. An item that does not apply to what is up is left out of the menu or turned off. Places not here have more.
`;

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/workspace/system-skills/instrument-guide/places.md",
);

describe("the product guide skill's places", () => {
  beforeAll(() => {
    // jsdom has no layout, and so no scrolling.
    HTMLElement.prototype.scrollTo = none;
    HTMLElement.prototype.scrollIntoView = none;
    // The window's own browser, which a row of the page's menu is there for.
    vi.stubGlobal("chrome", {});
    return () => {
      vi.unstubAllGlobals();
    };
  });

  it("are what the app's menus and bars have", async () => {
    const lines = [
      HEAD.replace("SECTIONS", SECTIONS.map(({ title }) => title).join(", ")),
    ];
    for (const { places, title } of SECTIONS) {
      lines.push(`## ${title}`, "");
      for (const [reach, read] of places) {
        const readings = new Map<System, Offer[][]>();
        for (const { name, platform } of SYSTEMS) {
          Object.defineProperty(window, "electron", {
            configurable: true,
            value: { process: { platform } },
          });
          readings.set(name, await read());
          cleanup();
        }
        lines.push(`- ${reach}: ${merged(readings).join("; ")}`);
      }
      lines.push("");
    }
    await expect(lines.join("\n")).toMatchFileSnapshot(OUT);
  }, 20_000);
});
