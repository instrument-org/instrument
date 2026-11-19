import { type WindowTab } from "@/client/atoms/window";
import { addressOfTab } from "@/client/bookmarks/actions";
import { CaptionRoom } from "@/client/components/window-controls";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { BookmarksBar } from "@/client/components/window/bookmarks-bar";
import { chatListOptions } from "@/client/components/window/chat-list-query";
import { byLastUserMessage, type Chat } from "@/client/components/window/chats";
import { useWindow, WindowContext } from "@/client/components/window/context";
import { DragLayer } from "@/client/components/window/drag/drag-layer";
import { useSideStrip } from "@/client/components/window/drag/use-group-drag";
import { GroupSidebar } from "@/client/components/window/group-sidebar";
import { GroupTabContext } from "@/client/components/window/group-tab";
import {
  GROUP_GROUNDS,
  SIDE_TABS,
} from "@/client/components/window/group-view";
import { SidebarToggleSlot } from "@/client/components/window/inbox-toggle";
import { PaneTabs } from "@/client/components/window/pane-tabs";
import { useRowSlots } from "@/client/components/window/row-slots";
import { RowSourcesContext } from "@/client/components/window/row-half";
import { type PageLoad } from "@/client/components/window/row-lines";
import { screenLocation } from "@/client/components/window/screen-presentation";
import {
  ShellContext,
  useShell,
} from "@/client/components/window/shell-context";
import {
  scrollToShow,
  SIDE_SHARE_DEFAULT,
  SIDE_WIDTH_MIN,
} from "@/client/components/window/side-widths";
import { standInTabsAtom } from "@/client/components/window/stand-in-tabs";
import { type TabGroup } from "@/client/components/window/tab-groups";
import {
  TabLocationRow,
  TabRowControl,
} from "@/client/components/window/tab-location-row";
import {
  type GroupLayout,
  type WindowTabs,
} from "@/client/components/window/tab-model";
import {
  surfaceLocation,
  tabSurfaceAtom,
} from "@/client/components/window/tab-surface";
import { useTaskTitles } from "@/client/components/window/task-titles";
import {
  WINDOW_CARD,
  WINDOW_CARD_GAP,
} from "@/client/components/window/window-frame";
import { chatHref, matchScreen } from "@/client/components/window/window-href";
import { useWindowTabs } from "@/client/components/window/window-tabs";
import { cn, isMacOS } from "@/client/lib/utils";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { type Draft } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { useQuery } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import { createStore, Provider, useAtomValue } from "jotai";
import { noop } from "radashi";
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  CAST,
  castAt,
  type CastChat,
  type CastKey,
  REAL_FIRST,
  type RowSpec,
} from "./fixtures";

/**
 * A window drawn from fixture tabs with the window's own parts: the
 * sidebar's rows, each side's strip, toolbar and bookmarks bar, and the
 * screens a side shows, each under a router of its own. Every frame is a
 * store of its own (`Picture`), so what it shows and what a drag frozen in
 * it would do stay out of the window it is drawn in, and nothing in it takes
 * a drop or changes a tab.
 */

/** What a frame's parts read about the chats and files they show. */
interface Cast {
  /** A cast chat as a row shows it: the workspace's own where it stands for one. */
  chatOf: (key: CastKey) => Chat;
  /** Whether a chat's page can be drawn: one the workspace has. */
  isReal: (chat: ChatId) => boolean;
  /** Files whose page is drawn by a stand-in, since the workspace has none of that kind. */
  standInFiles: ReadonlySet<string>;
  /** The fixture tabs, with the chats that stand for the workspace's own at their addresses. */
  tabsOf: (tabs: WindowTabs) => WindowTabs;
  titles: Map<ChatId, string>;
}

const CastContext = createContext<Cast | null>(null);

function useCast(): Cast {
  const cast = use(CastContext);
  if (!cast) {
    throw new Error("A picture is drawn inside a CastProvider");
  }
  return cast;
}

/** A cast chat that is not the workspace's, as a row reads it. */
function standInChat(chat: CastChat): Chat {
  const isWorking = chat.status === "working";
  const row = {
    archived: false,
    holds: { apps: [], files: [], sites: [] },
    id: chat.id,
    lastUserMessageAt: 0,
    latest: {
      at: 0,
      kind: isWorking ? "step" : "reply",
      text: isWorking ? (chat.step ?? chat.latest) : chat.latest,
    },
    starred: false,
    status: chat.status ?? "idle",
    title: chat.title,
    unread: chat.unread ?? false,
    working: isWorking,
  };
  // A row stands in for the whole wire row, as the chat list's tests do:
  // nothing a row or a strip draws reads the rest.
  return row as unknown as Chat;
}

/**
 * The cast for every frame under it: the first chats stand for the
 * workspace's latest, so a chat's page and its row are its own; the rest
 * are the fixture's.
 */
export function CastProvider({
  children,
  standInFiles,
}: {
  children: ReactNode;
  standInFiles: ReadonlySet<string>;
}) {
  const shell = useShell();
  const { data: chats = [] } = useQuery(chatListOptions());
  const latest = byLastUserMessage(chats.filter((each) => !each.archived));
  const real = new Map<CastKey, Chat>();
  for (const [index, key] of REAL_FIRST.entries()) {
    const chat = latest[index];
    if (chat) {
      real.set(key, chat);
    }
  }
  const titles = new Map(shell.chatTitles);
  for (const key of Object.keys(CAST).filter(isCastKey)) {
    if (!real.has(key)) {
      titles.set(CAST[key].id, CAST[key].title);
    }
  }
  const realIds = new Set([...real.values()].map((chat) => chat.id));
  const moves = [...real].map(([key, chat]) => ({
    from: chatHref(CAST[key].id),
    to: chatHref(chat.id),
  }));
  const cast: Cast = {
    chatOf: (key) => real.get(key) ?? standInChat(CAST[key]),
    isReal: (chat) => realIds.has(chat),
    standInFiles,
    tabsOf: (tabs) =>
      moves.length === 0
        ? tabs
        : {
            ...tabs,
            tabs: tabs.tabs.map((tab) => {
              if (tab.kind !== "screen") {
                return tab;
              }
              const move = moves.find((each) => each.from === tab.href);
              return move ? { ...tab, href: move.to } : tab;
            }),
          },
    titles,
  };
  return (
    <CastContext value={cast}>
      <ShellContext value={{ ...shell, chatTitles: titles }}>
        <RowSourcesContext
          value={{
            chats: Object.keys(CAST)
              .filter(isCastKey)
              .map((key) => cast.chatOf(key)),
            drafts: [],
          }}
        >
          {children}
        </RowSourcesContext>
      </ShellContext>
    </CastContext>
  );
}

/**
 * What the rows under it read beside the cast's chats: the drafts given,
 * and the pages' loads by their tabs.
 */
export function CastSources({
  children,
  drafts = [],
  pageLoads,
}: {
  children: ReactNode;
  drafts?: readonly Draft[];
  pageLoads?: ReadonlyMap<string, PageLoad>;
}) {
  const { chatOf } = useCast();
  return (
    <RowSourcesContext
      value={{
        chats: Object.keys(CAST).filter(isCastKey).map(chatOf),
        drafts,
        ...(pageLoads ? { pageLoads } : {}),
      }}
    >
      {children}
    </RowSourcesContext>
  );
}

function isCastKey(key: string): key is CastKey {
  return key in CAST;
}

/** The sidebar rows a frame lists, as the window lists its groups. */
export function useRows(specs: readonly RowSpec[]): TabGroup[] {
  const { chatOf } = useCast();
  return specs.map((spec): TabGroup => {
    const named = spec.name === undefined ? {} : { name: spec.name };
    const pinned = spec.pinned ?? false;
    if ("chat" in spec) {
      const chat = chatOf(spec.chat);
      return {
        chat,
        group: spec.group,
        kind: "chat",
        pinned,
        title: chat.title,
        ...named,
      };
    }
    return {
      group: spec.group,
      kind: "tabs",
      pinned,
      title: spec.title,
      ...named,
    };
  });
}

/**
 * A store of a frame's own, reading the fixture's tabs in place of the
 * window's (`standInTabsAtom`): what its parts show, and what a drag frozen
 * in it is.
 */
export function Picture({
  children,
  tabs,
}: {
  children: ReactNode;
  tabs: WindowTabs;
}) {
  const { tabsOf } = useCast();
  const shown = tabsOf(tabs);
  const [store] = useState(() => {
    const made = createStore();
    made.set(standInTabsAtom, shown);
    return made;
  });
  useLayoutEffect(() => {
    store.set(standInTabsAtom, shown);
  }, [shown, store]);
  return <Provider store={store}>{children}</Provider>;
}

/**
 * One frame of the gallery: a true-size picture, laid out once it nears
 * the view and kept from then on, which takes no input. What a drag frozen
 * in it draws over the window is drawn over the frame (`contain`).
 */
export function Frame({
  caption,
  children,
  height,
  note,
  width,
}: {
  caption: string;
  children: ReactNode;
  height: number;
  note?: ReactNode;
  width: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isNear, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || isNear) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [isNear]);
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">{caption}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {width} × {height}
        </span>
      </figcaption>
      {note && (
        <p className="max-w-3xl text-xs text-muted-foreground">{note}</p>
      )}
      <div className="max-w-full overflow-x-auto pb-1">
        <div
          className="relative shrink-0 overflow-hidden rounded-xl ring-1 ring-border"
          data-picture=""
          inert
          ref={ref}
          style={{ contain: "layout paint", height, width }}
        >
          {isNear && children}
        </div>
      </div>
    </figure>
  );
}

/** Whether the sidebar is beside the group: listed, left out of the frame, or closed, which leaves room for the traffic lights over the first side's strip. */
type SidebarShown = { rows: readonly TabGroup[] } | "closed" | "left out";

/**
 * A window as a frame draws it: the sidebar's list, when shown, and one
 * group's sides on the window's ground, the window's drag layer over both.
 */
export function WindowPicture({
  group,
  share,
  sidebar,
  sideBodies,
}: {
  group: string;
  share?: number;
  sidebar: SidebarShown;
  /** What a side's page shows in place of the page itself, by side. */
  sideBodies?: Partial<Record<0 | 1, ReactNode>>;
}) {
  const { titles } = useCast();
  const rows = typeof sidebar === "string" ? undefined : sidebar.rows;
  return (
    <div className="relative flex size-full bg-ground">
      {rows && (
        <div className="h-full w-80 shrink-0">
          <SidebarPicture groupUp={group} rows={rows} />
        </div>
      )}
      <div className="relative m-2 flex min-h-0 min-w-0 flex-1 [--background:var(--pane)] [--guest-bottom-radius:18px]">
        <div className="@container/app-content flex min-h-0 min-w-0 flex-1">
          <div className={GROUP_GROUNDS} data-own-cards="">
            <Sides
              group={group}
              share={share ?? SIDE_SHARE_DEFAULT}
              sideBodies={sideBodies ?? {}}
            />
          </div>
        </div>
      </div>
      {sidebar !== "left out" && (
        <ToggleMark isSidebarOpen={rows !== undefined} />
      )}
      <DragLayer chatTitles={titles} entries={rows ?? []} />
    </div>
  );
}

const TRAFFIC_LIGHTS = ["#ff5f57", "#febc2e", "#28c840"];

/**
 * The Mac's traffic lights while the sidebar is out, centered on the tab
 * strips: a picture of them, since the window's own come and go with its
 * own sidebar.
 */
function ToggleMark({ isSidebarOpen }: { isSidebarOpen: boolean }) {
  return isMacOS() && isSidebarOpen ? (
    <div
      className="absolute left-5 flex h-10 items-center gap-2"
      style={{ top: WINDOW_CARD_GAP }}
    >
      {TRAFFIC_LIGHTS.map((color) => (
        <span
          className="size-3 rounded-full"
          key={color}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  ) : null;
}

/** The sidebar toggle in its slot, a picture of it, since the toggle itself shows and hides the window's own sidebar. */
function ToggleInStrip() {
  return (
    <SidebarToggleSlot>
      <span className="flex size-7 items-center justify-center text-muted-foreground/70">
        <SidebarSimpleIcon className="size-4" />
      </span>
    </SidebarToggleSlot>
  );
}

/** The sidebar's list of a frame's groups, which nothing in takes a click. */
export function SidebarPicture({
  groupUp,
  rows,
}: {
  groupUp: string | undefined;
  rows: readonly TabGroup[];
}) {
  const { titles } = useCast();
  return (
    <GroupSidebar
      chatTitles={titles}
      groupUp={groupUp}
      onClose={noop}
      onCloseAll={noop}
      onCloseSide={noop}
      onDuplicate={noop}
      onNew={noop}
      onNewChatProject={noop}
      onNewProject={noop}
      onPin={noop}
      onReopenLast={noop}
      onShow={noop}
      open={[...rows]}
      projects={[]}
    />
  );
}

/** A group's sides in their row, as `GroupSides` lays them out: shared by the share, never under a side's narrowest, scrolling sideways below that. */
function Sides({
  group,
  share,
  sideBodies,
}: {
  group: string;
  share: number;
  sideBodies: Partial<Record<0 | 1, ReactNode>>;
}) {
  const { layoutOf } = useWindowTabs();
  const layout = layoutOf(group);
  const isTwo = layout.sides.length === 2;
  const scrollerRef = useRef<HTMLDivElement>(null);
  // The side with the keyboard in view, as a group comes up.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const side = scroller?.querySelector<HTMLElement>(
      "[data-group-side][data-keyboard]",
    );
    if (scroller && side) {
      scroller.scrollLeft = scrollToShow({
        end: side.offsetLeft + side.offsetWidth,
        scroll: scroller.scrollLeft,
        start: side.offsetLeft,
        view: scroller.clientWidth,
      });
    }
  }, []);
  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      ref={scrollerRef}
    >
      <div
        className="flex h-full"
        style={{
          minWidth: isTwo
            ? SIDE_WIDTH_MIN * 2 + WINDOW_CARD_GAP
            : SIDE_WIDTH_MIN,
        }}
      >
        {layout.sides.map((_, index) => {
          const at = index === 1 ? 1 : 0;
          const grow = isTwo ? (at === 0 ? share : 1 - share) : 1;
          return (
            <Side
              body={sideBodies[at]}
              group={group}
              isFirst={at === 0}
              isLast={index === layout.sides.length - 1}
              key={at}
              layout={layout}
              sideIndex={at}
              style={{ flex: `${grow} 1 0px`, minWidth: SIDE_WIDTH_MIN }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** One side's card, as `SideCard` draws it: its strip, then what its tab up shows under its toolbar and bookmarks. */
function Side({
  body,
  group,
  isFirst,
  isLast,
  layout,
  sideIndex,
  style,
}: {
  body: ReactNode;
  group: string;
  isFirst: boolean;
  isLast: boolean;
  layout: GroupLayout;
  sideIndex: 0 | 1;
  style: CSSProperties;
}) {
  const shell = useShell();
  const side = layout.sides[sideIndex];
  const tabs = side?.tabs ?? [];
  const up = tabs.find((tab) => tab.id === side?.up);
  const hasKeyboard = layout.focused === sideIndex;
  const drawn = useSideStrip({ group, side: sideIndex, tabs });
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col",
        WINDOW_CARD,
        !isLast && "mr-2",
      )}
      data-group-side={sideIndex}
      {...(hasKeyboard ? { "data-keyboard": "" } : {})}
      style={style}
    >
      <PaneTabs
        carriedKey={drawn.carriedKey}
        chatTitles={shell.chatTitles}
        chosenId={drawn.chosenId ?? up?.id}
        className={SIDE_TABS}
        heldAt={drawn.heldAt}
        lead={isFirst ? <ToggleInStrip /> : undefined}
        onClose={noop}
        onDuplicate={noop}
        onNew={noop}
        onSelect={noop}
        side={sideIndex}
        split={{
          group,
          hasKeyboard: false,
          hasOtherSide: layout.sides.length === 2,
          onCloseSplit: undefined,
          onJoinSides: undefined,
          onMoveToNewGroup: undefined,
          onMoveToNewWindow: undefined,
          onMoveToOtherSide: noop,
          onMoveToWindow: noop,
          onNewChatInSplit: noop,
          onOpenInSplit: noop,
        }}
        tabs={drawn.tabs}
        taskTitles={shell.childTitles}
        trailing={isLast ? <CaptionRoom /> : undefined}
      />
      <div className="relative min-h-0 flex-1" data-side-page={sideIndex}>
        {up && <SidePage body={body} group={group} key={up.id} up={up} />}
      </div>
    </div>
  );
}

/** The screens whose toolbar has a reload, as `GroupItem` gives them one. */
const RELOADED = new Set([
  "activity",
  "apps",
  "chat",
  "chats",
  "memories",
  "settings",
  "skills",
]);

/** A side's tab up as `GroupItem` draws it: the toolbar, the bookmarks bar, and its page. */
function SidePage({
  body,
  group,
  up,
}: {
  body: ReactNode;
  group: string;
  up: WindowTab;
}) {
  const appsBySlug = useAppsBySlug();
  const taskTitles = useTaskTitles();
  const { chatTitles } = useShell();
  const surface = useAtomValue(tabSurfaceAtom)[up.id];
  const { rowProps, slots } = useRowSlots();
  const kind = up.kind === "page" ? "page" : matchScreen(up.href).kind;
  const reload = (
    <TabRowControl
      chord="reloadPage"
      disabled={kind === "inbox"}
      icon={<ArrowClockwiseIcon className="size-4" />}
      label="Reload"
      onClick={noop}
    />
  );
  let head: ReactNode;
  if (up.kind === "page") {
    head = (
      <TabLocationRow
        address={addressOfTab(up)}
        canGoBack
        className="border-b-0"
        location={{ kind: "page", url: up.url ?? "" }}
        onBack={noop}
        onForward={noop}
        title={up.title}
        {...rowProps}
        reload={reload}
      />
    );
  } else {
    const location = surfaceLocation(
      screenLocation(up.href, { appsBySlug, chatTitles, taskTitles }),
      surface,
    );
    head = (
      <TabLocationRow
        {...(kind === "inbox" ? {} : { address: addressOfTab(up) })}
        className="border-b-0"
        {...(kind === "inbox" ? { fieldTakesCaret: false } : {})}
        location={location}
        onBack={noop}
        onForward={noop}
        {...rowProps}
        {...(RELOADED.has(kind) || kind === "inbox"
          ? {
              reload: (
                <>
                  {rowProps.reload}
                  {reload}
                </>
              ),
            }
          : {})}
      />
    );
  }
  return (
    <div className="flex h-full flex-col bg-background">
      {head}
      <BookmarksBar files={{ group }} onOpen={noop} onVisit={noop} />
      <div className="relative min-h-0 flex-1">
        {body ?? <SideBody group={group} slots={slots} up={up} />}
      </div>
    </div>
  );
}

/** What a side's tab up shows: its own screen, or a stand-in where the frame cannot draw one. */
function SideBody({
  group,
  slots,
  up,
}: {
  group: string;
  slots: ReturnType<typeof useRowSlots>["slots"];
  up: WindowTab;
}) {
  const { isReal, standInFiles } = useCast();
  if (up.kind === "page") {
    const filePath = hostPathOfFileUrl(up.url);
    return filePath === undefined ? <SiteStandIn tab={up} /> : null;
  }
  const screen = matchScreen(up.href);
  if (screen.kind === "chat" && !isReal(screen.chat)) {
    return <ChatStandIn chat={castAt(screen.chat)} />;
  }
  if (
    screen.kind === "computer" &&
    screen.file !== undefined &&
    standInFiles.has(screen.file)
  ) {
    return <FileStandIn path={screen.file} />;
  }
  return <ScreenRoute group={group} href={up.href} id={up.id} slots={slots} />;
}

/**
 * A screen at its address, under a router of its own, as a group's tab
 * draws it (`GroupItem`): what it puts in the toolbar goes into the side's
 * row. It never has the keyboard, so a chat here marks nothing read and
 * takes no caret.
 */
function ScreenRoute({
  group,
  href,
  id,
  slots,
}: {
  group: string;
  href: string;
  id: string;
  slots: ReturnType<typeof useRowSlots>["slots"];
}) {
  const appWindow = useWindow();
  // The page's own router lends its routes and settings, so a frame's
  // screens are the app's without this module reaching the route tree,
  // which reaches this page.
  const outer = useRouter();
  const [router] = useState(() =>
    createRouter({
      ...outer.options,
      history: createMemoryHistory({ initialEntries: [href] }),
    }),
  );
  return (
    <GroupTabContext
      value={{
        close: noop,
        group,
        hasKeyboard: false,
        id,
        isShown: true,
        showPage: noop,
        versionsOf: undefined,
      }}
    >
      <WindowContext
        value={{
          ...appWindow,
          rowField: slots.field,
          rowLead: slots.lead,
          rowReload: slots.reload,
          rowTail: slots.tail,
        }}
      >
        <div className="relative h-full">
          <RouterProvider router={router} />
        </div>
      </WindowContext>
    </GroupTabContext>
  );
}

/** Says a page body is drawn by the debug page, not by the app. */
function StandInBadge({ children }: { children: ReactNode }) {
  return (
    <span className="absolute top-2 right-2 z-10 rounded-md bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-background">
      {children}
    </span>
  );
}

/** A grey bar of a given width, for words a stand-in page only suggests. */
function Line({ className }: { className: string }) {
  return (
    <div className={cn("h-2.5 rounded-full bg-foreground/10", className)} />
  );
}

/** The colors of a site's page, which are the site's own whatever the app's theme. */
const SITE = {
  ground: "#ffffff",
  ink: "#1c1c1e",
  line: "#e4e4e7",
  muted: "#71717a",
  picture: "linear-gradient(135deg, #bae6fd, #fef3c7)",
} as const;

/** A site's page, which a live guest draws in the app: its name, a headline, text and a picture. */
function SiteStandIn({ tab }: { tab: WindowTab }) {
  const host =
    tab.kind === "page" && tab.url && URL.canParse(tab.url)
      ? new URL(tab.url).hostname.replace(/^www\./, "")
      : "";
  const line = (width: string) => (
    <div
      className="h-2.5 rounded-full"
      style={{ backgroundColor: SITE.line, width }}
    />
  );
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor: SITE.ground, color: SITE.ink }}
    >
      <StandInBadge>Stand-in for a live page</StandInBadge>
      <div
        className="flex h-12 items-center gap-6 overflow-hidden border-b pr-44 pl-6"
        style={{ borderColor: SITE.line }}
      >
        <span className="text-sm font-semibold">{host}</span>
        <span className="flex gap-4 text-xs" style={{ color: SITE.muted }}>
          <span>Home</span>
          <span>Explore</span>
          <span>About</span>
        </span>
      </div>
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        <div className="text-2xl leading-tight font-semibold">
          {tab.kind === "page" ? tab.title : ""}
        </div>
        <div className="flex flex-col gap-2">
          {line("100%")}
          {line("92%")}
          {line("80%")}
        </div>
        <div
          className="aspect-video w-full rounded-lg"
          style={{ background: SITE.picture }}
        />
        <div className="flex flex-col gap-2">
          {line("100%")}
          {line("84%")}
          {line("100%")}
          {line("66%")}
        </div>
      </div>
    </div>
  );
}

/** A chat the workspace does not have: the person's message, the reply, and the composer. */
function ChatStandIn({ chat }: { chat: CastChat | undefined }) {
  return (
    <div className="absolute inset-0 flex flex-col">
      <StandInBadge>Stand-in for a chat</StandInBadge>
      <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-1 flex-col gap-4 overflow-hidden px-6 pt-8">
        <div className="ml-auto max-w-[80%] rounded-2xl bg-foreground/[0.06] px-4 py-2 text-sm">
          {chat?.asked}
        </div>
        <div className="flex flex-col gap-2 text-sm leading-6">
          <p>{chat?.latest}</p>
          <Line className="w-full" />
          <Line className="w-5/6" />
        </div>
      </div>
      <div className="mx-auto mb-4 w-full max-w-2xl px-4">
        <div className="h-24 rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm-soft ring-1 ring-foreground/[0.08]">
          Talk to Instrument
        </div>
      </div>
    </div>
  );
}

/** A file of a kind the workspace has none of, as its viewer would show it: Markdown read as a page, text as lines of code, a picture as itself. */
function FileStandIn({ path }: { path: string }) {
  const name = path.split("/").at(-1) ?? path;
  const badge = <StandInBadge>Stand-in for {name}</StandInBadge>;
  if (/\.(?:png|jpe?g|gif|webp|heic)$/i.test(name)) {
    return (
      <div className="absolute inset-0 grid place-items-center p-8">
        {badge}
        <div
          className="aspect-[4/3] w-full max-w-xl rounded-sm shadow-md"
          style={{ background: SITE.picture }}
        />
      </div>
    );
  }
  if (!/\.md$/i.test(name)) {
    return (
      <div className="absolute inset-0 overflow-hidden px-4 py-3 font-mono text-xs leading-5">
        {badge}
        {TEXT_LINES.map((text, index) => (
          <div className="flex gap-4 whitespace-pre" key={index}>
            <span className="w-6 text-right text-muted-foreground">
              {index + 1}
            </span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden">
      {badge}
      <div className="mx-auto flex max-w-2xl flex-col gap-3 px-8 py-8 text-sm leading-6">
        <div className="text-2xl font-semibold">Lisbon in March</div>
        <p>
          Four nights in Alfama, then two in Sintra. Flights land at 9:40 on the
          12th.
        </p>
        <div className="text-lg font-semibold">Where to stay</div>
        <ul className="list-disc pl-5">
          <li>Casa do Largo, €112 a night, terrace over the river</li>
          <li>Alfama Patio, €98 a night, ten minutes from the tram</li>
          <li>Memmo Alfama, €210 a night, pool and breakfast</li>
        </ul>
        <div className="text-lg font-semibold">To book</div>
        <p>
          The tram tour on the 13th and dinner at Taberna da Rua das Flores.
        </p>
      </div>
    </div>
  );
}

/** A short script, for a text file's stand-in. */
const TEXT_LINES = [
  "import csv",
  "",
  'QUOTES = "quotes.csv"',
  "",
  "def cheapest(path):",
  "    with open(path) as file:",
  "        rows = list(csv.DictReader(file))",
  '    return min(rows, key=lambda row: float(row["total"]))',
  "",
  'if __name__ == "__main__":',
  "    best = cheapest(QUOTES)",
  "    print(f\"{best['roofer']}: ${best['total']}\")",
];
