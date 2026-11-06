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
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { useComputerVolumes } from "./computer-volumes";
import { WindowContext } from "./context";
import { useFileTabTitles } from "./file-tab-titles";
import { screenLocation, screenPresentation } from "./screen-presentation";

type Presentation = Parameters<typeof screenPresentation>[1];

/** A layout change that lands at once, for tabs moved by anything but a drag. */
const STILL = { layout: { duration: 0 } };

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
 * A chat's tabs, across the head of the pane beside it, the one place they
 * show: what its agent browses and the person opened, oldest at the left,
 * scrolling sideways when there are many. Pressing one brings it up, its ×
 * takes it out of the chat, and dragging one moves it among the others. The ×
 * at the row's far end puts the whole pane away and keeps the tabs.
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
  // Tabs slide only while one is being dragged among them: laid out otherwise,
  // they would slide every time the pane around them resizes.
  const [isDragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // The chosen tab is brought into the row's view. Offsets are layout px, which
  // is what scrollLeft is in under the window's zoom.
  useEffect(() => {
    const list = listRef.current;
    const tab = [
      ...(list?.querySelectorAll<HTMLElement>("[data-pane-tab]") ?? []),
    ].find((element) => element.dataset.paneTab === chosenId);
    if (!list || !tab) {
      return;
    }
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < list.scrollLeft) {
      list.scrollTo({ behavior: "smooth", left });
    } else if (right > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ behavior: "smooth", left: right - list.clientWidth });
    }
  }, [chosenId, tabs.length]);
  return (
    <div
      aria-label="What this chat has open"
      className="flex h-10 shrink-0 items-center gap-1 px-2"
      role="tablist"
    >
      <motion.div
        className="relative flex min-w-0 [scrollbar-width:none] overflow-x-auto"
        layoutScroll
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
              onDragEnd={() => {
                setDragging(false);
              }}
              onDragStart={() => {
                setDragging(true);
              }}
              transition={isDragging ? undefined : STILL}
              value={keyOf(tab)}
            >
              <PaneTab
                chatTitles={chatTitles}
                isChatWorking={isChatWorking}
                isChosen={tab.id === chosenId}
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
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onSelect={onAddWeb}>
            <GlobeIcon className="size-3.5" />
            Browser
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddComputer}>
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
  onClose,
  onSelect,
  tab,
  taskTitles,
}: {
  chatTitles: Presentation["chatTitles"];
  isChatWorking: boolean;
  isChosen: boolean;
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
        "group/tab flex h-7 w-36 items-center gap-0.5 rounded-lg pr-0.5 pl-2 text-xs",
        isChosen
          ? "bg-card font-medium text-foreground ring-1 ring-border"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <button
        aria-selected={isChosen}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
        // A middle click closes it, as it does a browser's tab.
        onAuxClick={(event) => {
          if (event.button === 1) {
            onClose();
          }
        }}
        onClick={onSelect}
        onMouseDown={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
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
        className="grid size-5 shrink-0 place-items-center rounded-sm opacity-0 group-hover/tab:opacity-100 hover:bg-foreground/10 focus-visible:opacity-100"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3" weight="bold" />
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
