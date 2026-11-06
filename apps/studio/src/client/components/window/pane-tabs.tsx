import { type WindowTab } from "@/client/atoms/window";
import { PageFavicon } from "@/client/components/favicon";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { ShimmerSweep } from "@/client/components/shimmer-sweep";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { PageTooltip } from "@/client/components/window/page-tooltip";
import { useTargetAgentActivity } from "@/client/hooks/use-target-agent-activity";
import { cn, osConventions } from "@/client/lib/utils";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { BrowsersIcon } from "@phosphor-icons/react/Browsers";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { motion, Reorder } from "motion/react";
import {
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { useComputerVolumes } from "./computer-volumes";
import { WindowContext } from "./context";
import { useFileTabTitles } from "./file-tab-titles";
import { screenLocation, screenPresentation } from "./screen-presentation";

type Presentation = Parameters<typeof screenPresentation>[1];

/** A layout change that lands at once, for tabs moved by anything but a drag. */
const STILL = { layout: { duration: 0 } };

// The room around the tabs inside their scroller, the `p-1` it draws, in layout
// px. A scroller clips at its padding edge whatever `overflow-clip-margin` says,
// so a row exactly as tall as its tabs would slice the chosen tab's shadow flat.
const TAB_ROOM = 4;

function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}

/** A tab as the strip orders it. */
function keyOf(tab: WindowTab): string {
  return tab.stripKey ?? tab.id;
}

/**
 * Scrolls a tab clear of its row's ends. Offsets are layout px, which is what
 * scrollLeft is in under the window's zoom.
 */
function showTab(
  list: HTMLElement | null,
  id: string | undefined,
  behavior: ScrollBehavior,
) {
  const tab = [
    ...(list?.querySelectorAll<HTMLElement>("[data-pane-tab]") ?? []),
  ].find((element) => element.dataset.paneTab === id);
  if (!list || !tab) {
    return;
  }
  const left = tab.offsetLeft - TAB_ROOM;
  const right = tab.offsetLeft + tab.offsetWidth + TAB_ROOM;
  if (left < list.scrollLeft) {
    list.scrollTo({ behavior, left });
  } else if (right > list.scrollLeft + list.clientWidth) {
    list.scrollTo({ behavior, left: right - list.clientWidth });
  }
}

/**
 * A chat's tabs, across the head of the pane beside it, the one place they
 * show: what its agent browses and the person opened, oldest at the left,
 * scrolling sideways when there are many. Pressing one brings it up, its × or
 * the middle button takes it out of the chat, and dragging one moves it among
 * the others. The × at the row's far end puts the whole pane away and keeps the
 * tabs.
 */
export function PaneTabs({
  chatTitles,
  chosenId,
  isChatWorking,
  onAddComputer,
  onAddWeb,
  onClose,
  onHide,
  onReorder,
  onSelect,
  tabs,
  taskTitles,
}: {
  chatTitles: Presentation["chatTitles"];
  chosenId: string | undefined;
  /** Whether the chat or any task of it is at work: a page's working mark drops the moment none is. */
  isChatWorking: boolean;
  onAddComputer: () => void;
  onAddWeb: () => void;
  onClose: (id: string) => void;
  onHide: () => void;
  /** The chat's tabs in a new order, by their strip keys, oldest first. */
  onReorder: (keys: string[]) => void;
  onSelect: (id: string) => void;
  tabs: WindowTab[];
  taskTitles: Presentation["taskTitles"];
}) {
  // The tab out of its place, from the drag that picks it up until it has landed
  // back. Tabs slide only while there is one: laid out otherwise, they would
  // slide every time the pane around them resizes.
  const [liftedId, setLiftedId] = useState<string>();
  const rowRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasPicked = useRef(false);
  useEffect(() => {
    showTab(listRef.current, chosenId, "smooth");
  }, [chosenId, tabs.length]);
  const showChosenAtOnce = useEffectEvent(() => {
    showTab(listRef.current, chosenId, "instant");
  });
  // A narrower row would otherwise slide its end over the chosen tab's far side.
  // This watches the row rather than the scroller, whose width also follows the
  // tabs, so that a tab opening still glides into view.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    const observer = new ResizeObserver(() => {
      showChosenAtOnce();
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div
      aria-label="What this chat has open"
      className="flex h-10 shrink-0 items-center gap-1 px-2"
      ref={rowRef}
      role="tablist"
    >
      <motion.div
        className="relative -m-1 flex min-w-0 [scrollbar-width:none] overflow-x-auto p-1"
        layoutScroll
        // Refusing a middle press takes its mousedown with it, which is what
        // would start the system's autoscroll in a row that scrolls.
        onPointerDown={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
        // A wheel that only turns up and down scrolls the row sideways.
        onWheel={(event) => {
          const list = event.currentTarget;
          if (
            list.scrollWidth > list.clientWidth &&
            Math.abs(event.deltaY) > Math.abs(event.deltaX)
          ) {
            list.scrollLeft += event.deltaY;
          }
        }}
        ref={listRef}
      >
        <Reorder.Group
          as="div"
          axis="x"
          className="flex shrink-0 gap-0.5"
          onReorder={(keys: string[]) => {
            onReorder(keys);
          }}
          values={tabs.map(keyOf)}
        >
          {tabs.map((tab) => (
            <Reorder.Item
              as="div"
              className="shrink-0"
              data-pane-tab={tab.id}
              key={tab.id}
              // The chosen tab's new place may be past the row's end. Dropping
              // any other tab leaves the row where it is.
              onDragEnd={() => {
                if (tab.id === chosenId) {
                  showTab(listRef.current, tab.id, "smooth");
                }
              }}
              onDragStart={() => {
                setLiftedId(tab.id);
              }}
              onDragTransitionEnd={() => {
                setLiftedId((lifted) =>
                  lifted === tab.id ? undefined : lifted,
                );
              }}
              transition={liftedId === undefined ? STILL : undefined}
              value={keyOf(tab)}
            >
              <PaneTab
                chatTitles={chatTitles}
                isChatWorking={isChatWorking}
                isChosen={tab.id === chosenId}
                isLifted={tab.id === liftedId}
                onClose={() => {
                  onClose(tab.id);
                }}
                onSelect={() => {
                  onSelect(tab.id);
                }}
                tab={tab}
                taskTitles={taskTitles}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </motion.div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Open beside the chat"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            title="New"
            type="button"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-48"
          // What was picked comes up, so the + has nothing to keep the focus for,
          // and it would wear a focus ring after a pick made with the mouse.
          onCloseAutoFocus={(event) => {
            if (hasPicked.current) {
              hasPicked.current = false;
              event.preventDefault();
            }
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              hasPicked.current = true;
              onAddWeb();
            }}
          >
            <GlobeIcon className="size-3.5" />
            Browser
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              hasPicked.current = true;
              onAddComputer();
            }}
          >
            <DesktopIcon className="size-3.5" />
            {osConventions().computer}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        aria-label="Hide tabs"
        className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onHide}
        type="button"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

function PaneTab({
  chatTitles,
  isChatWorking,
  isChosen,
  isLifted,
  onClose,
  onSelect,
  tab,
  taskTitles,
}: {
  chatTitles: Presentation["chatTitles"];
  isChatWorking: boolean;
  isChosen: boolean;
  isLifted: boolean;
  onClose: () => void;
  onSelect: () => void;
  tab: WindowTab;
  taskTitles: Presentation["taskTitles"];
}) {
  const appsBySlug = useAppsBySlug();
  const volumes = useComputerVolumes();
  const windowContext = useContext(WindowContext);
  const fileTitles = useFileTabTitles([
    tab.kind === "page" ? undefined : tab.href,
  ]);
  const title =
    tab.kind === "page"
      ? tab.title || hostOf(tab.url ?? tab.openedUrl ?? "")
      : screenPresentation(tab.href, {
          appsBySlug,
          chatTitles,
          ...(fileTitles ? { fileTitles } : {}),
          taskTitles,
          ...(volumes ? { volumes } : {}),
        }).title;
  const mark =
    tab.kind === "page" ? (
      <PageFavicon
        favicon={tab.favicon}
        hasTooltip={false}
        url={tab.url ?? tab.openedUrl ?? ""}
      />
    ) : (
      <ScreenMark
        appsBySlug={appsBySlug}
        chatTitles={chatTitles}
        href={tab.href}
      />
    );
  const body = (isWorking: boolean) => (
    <div
      className={cn(
        // The close is 6px in on three sides, concentric with the 12px corner.
        "group/tab flex h-8 w-36 items-center gap-0.5 rounded-xl pr-1.5 pl-2 text-xs",
        isChosen && "bg-card font-medium text-foreground shadow-xs-soft",
        !isChosen &&
          (isLifted
            ? // Opaque, since it passes over the other tabs.
              "bg-card text-muted-foreground shadow-xs-soft"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"),
      )}
      // A middle press closes it anywhere on it, as it does a window tab, and
      // leaves what is up alone.
      onPointerDown={(event) => {
        if (event.button === 1) {
          onClose();
        }
      }}
    >
      <button
        aria-selected={isChosen}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onSelect}
        role="tab"
        // A page says what it is on hover; anything else, its name.
        title={tab.kind === "page" ? undefined : title}
        type="button"
      >
        <span className="grid size-3.5 shrink-0 place-items-center [&_img]:size-3.5 [&_svg]:size-3.5">
          {mark}
        </span>
        <span className={cn("truncate", isWorking && "brand-shiny-text")}>
          {title}
          {isWorking && <ShimmerSweep text={title} />}
        </span>
      </button>
      <button
        aria-label={`Close ${title}`}
        className="grid size-5 shrink-0 place-items-center rounded-md opacity-0 group-hover/tab:opacity-100 hover:bg-foreground/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
        // A press that became a drag ends in a click here too, since the × went
        // along under the pointer.
        onClick={() => {
          if (!isLifted) {
            onClose();
          }
        }}
        type="button"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
  if (tab.kind !== "page") {
    return body(false);
  }
  const pageUrl = tab.url ?? tab.openedUrl;
  const page = (isWorking: boolean) => {
    const tooltipped = (
      <PageTooltip title={tab.title} url={pageUrl ?? ""}>
        {body(isWorking)}
      </PageTooltip>
    );
    return pageUrl === undefined ? (
      tooltipped
    ) : (
      <ContextMenu>
        <ContextMenuTrigger asChild>{tooltipped}</ContextMenuTrigger>
        <ContextMenuContent>
          {windowContext && (
            <ContextMenuItem
              onSelect={() => {
                windowContext.openPage(pageUrl, { newTab: true });
              }}
            >
              <BrowsersIcon className="size-4" />
              Open in Browser Tab
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(pageUrl);
            }}
          >
            <CopyIcon className="size-4" />
            Copy URL
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onClose}>
            <XIcon className="size-4" />
            Close
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };
  return (
    <PageWorking isChatWorking={isChatWorking} tabId={tab.id}>
      {page}
    </PageWorking>
  );
}

/**
 * Whether an agent is at work in a page: while its commands keep arriving, and
 * never once nothing in the chat is at work, so the mark does not outlast the
 * work by the quiet it waits out.
 */
function PageWorking({
  children,
  isChatWorking,
  tabId,
}: {
  children: (isWorking: boolean) => ReactNode;
  isChatWorking: boolean;
  tabId: string;
}) {
  const isDriven = useTargetAgentActivity(browserTargetOf(tabId));
  return children(isChatWorking && isDriven);
}

/** A screen's small mark: a file's type, a folder, or the screen's own icon. */
function ScreenMark({
  appsBySlug,
  chatTitles,
  href,
}: {
  appsBySlug: Presentation["appsBySlug"];
  chatTitles: Presentation["chatTitles"];
  href: string;
}) {
  const location = screenLocation(href, { appsBySlug, chatTitles });
  if (location.kind === "file") {
    return <FileTypeIcon className="size-3.5" fileName={location.name} />;
  }
  if (location.kind === "folder") {
    return <FileSystemFolderGlyph className="h-3 w-auto" />;
  }
  return screenPresentation(href, { appsBySlug, chatTitles }).icon;
}
