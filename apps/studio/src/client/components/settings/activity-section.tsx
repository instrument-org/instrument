import { settingsModalAtom } from "@/client/atoms/settings-modal";
import {
  ConnectionMark,
  RequestDetail,
  TurnDetail,
  useModelName,
} from "@/client/components/settings/activity-requests";
import {
  type ActivityRequest,
  type ActivityView,
  ACTIVITY_VIEWS,
  actionText,
  leadOf,
  placeOf,
  type ShownAction,
  timelineOf,
  type TimelineItem,
  type Turn,
  turnText,
  withDayHeads,
} from "@/client/components/settings/activity-timeline";
import { ClearActivityDialog } from "@/client/components/settings/clear-activity-dialog";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { WindowContext } from "@/client/components/window/context";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Switch } from "@/client/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { useModalBack } from "@/client/hooks/use-modal-back";
import {
  openClickGestures,
  useGesturesFor,
} from "@/client/hooks/use-open-target";
import { displayLocale } from "@/client/lib/display-locale";
import { keptAtom } from "@/client/lib/kept-state";
import { type OpenTarget } from "@/client/lib/open-target";
import { toast } from "@/client/lib/toast";
import { cn, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowCircleUpIcon } from "@phosphor-icons/react/ArrowCircleUp";
import { ArrowBendDownRightIcon } from "@phosphor-icons/react/ArrowBendDownRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { FileIcon } from "@phosphor-icons/react/File";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { FolderPlusIcon } from "@phosphor-icons/react/FolderPlus";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { LockSimpleIcon } from "@phosphor-icons/react/LockSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlugsIcon } from "@phosphor-icons/react/Plugs";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { TextboxIcon } from "@phosphor-icons/react/Textbox";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import {
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtom, useSetAtom } from "jotai";
import { type ReactNode, useContext, useEffect, useState } from "react";

const PAGE_SIZE = 100;
/** A row's height and a day head's, in layout px. */
const ROW_HEIGHT = 40;
const DAY_HEIGHT = 28;

/** The query keys of the person's actions and the AI requests, which Clear starts over. */
const ACTIONS_KEY = ["actions", "list"];
const REQUESTS_KEY = ["activity", "timeline"];

/** Which of the two logs the list shows, kept per viewer. */
const activityViewAtom = keptAtom<ActivityView>(
  "view",
  "activity.view.v1",
  "all",
  (value, initial) => ACTIVITY_VIEWS.find((view) => view === value) ?? initial,
);

const VIEW_LABELS: Record<ActivityView, string> = {
  ai: "AI",
  all: "All",
  yours: "You",
};

const EMPTY: Record<ActivityView, string> = {
  ai: "No AI requests yet.",
  all: "No activity yet.",
  yours: "No activity of yours yet.",
};

const timeFormat = new Intl.DateTimeFormat(displayLocale, {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Settings › Activity: what the person did in the app and the AI requests it
 * made, as one list newest first, so an afternoon reads in the order it
 * happened. A chat turn's requests are one row, which opens to the requests
 * themselves; a row of the person's own opens the place it names.
 *
 * Both logs stay on this computer: the person's in the workspace's machine
 * folder (`docs/architecture/action-log.md`), the requests in the
 * workspace's own records (`packages/workspace/src/lib/activity/record.ts`).
 * Saving a CSV is the only way either leaves, and the person does that.
 */
export function ActivitySection() {
  // Both logs are read up to when the section opened, so what is recorded
  // while it is open never shifts a page.
  const [until] = useState(() => Date.now());
  const [opened, setOpened] = useState<null | {
    request?: string;
    turn: Turn;
  }>(null);
  useModalBack(() => {
    setOpened((current) =>
      current?.request === undefined ? null : { turn: current.turn },
    );
  }, opened !== null);

  if (opened?.request !== undefined) {
    return (
      <RequestDetail
        id={opened.request}
        onBack={() => {
          setOpened({ turn: opened.turn });
        }}
      />
    );
  }
  if (opened) {
    return (
      <TurnDetail
        onBack={() => {
          setOpened(null);
        }}
        onOpen={(request) => {
          setOpened({ request, turn: opened.turn });
        }}
        turn={opened.turn}
      />
    );
  }
  return (
    <ActivityTimeline
      onOpenTurn={(turn) => {
        setOpened({ turn });
      }}
      until={until}
    />
  );
}

/** Whether an infinite query has read all there is, or will read no more. */
function isComplete<T>(query: UseInfiniteQueryResult<InfiniteData<T>>) {
  return query.isError || (query.isSuccess && !query.hasNextPage);
}

function ActivityTimeline({
  onOpenTurn,
  until,
}: {
  onOpenTurn: (turn: Turn) => void;
  until: number;
}) {
  const [view, setView] = useAtom(activityViewAtom);
  const queryClient = useQueryClient();

  const actions = useInfiniteQuery({
    enabled: view !== "ai",
    getNextPageParam: (last: { next: null | number }) => last.next ?? undefined,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      rpcClient.actions.list.call(
        { cursor: pageParam, limit: PAGE_SIZE, since: 0, until },
        { signal },
      ),
    queryKey: [...ACTIONS_KEY, until],
  });
  const requests = useInfiniteQuery({
    enabled: view !== "yours",
    getNextPageParam: (last: ActivityRequest[], all: ActivityRequest[][]) =>
      last.length < PAGE_SIZE ? undefined : all.length * PAGE_SIZE,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      rpcClient.workspace.activity.list.call(
        {
          filter: { until },
          limit: PAGE_SIZE,
          offset: pageParam,
          sort: { column: "startedAt", direction: "desc" },
        },
        { signal },
      ),
    queryKey: [...REQUESTS_KEY, until],
  });

  const { entries, waitingOn } = timelineOf({
    actions: {
      complete: isComplete(actions),
      items: actions.data?.pages.flatMap((page) => page.actions) ?? [],
    },
    requests: {
      complete: isComplete(requests),
      items: requests.data?.pages.flat() ?? [],
    },
    view,
  });
  const empty = entries.length === 0 && waitingOn.length === 0;

  const loadMore = () => {
    for (const [source, query] of [
      ["actions", actions],
      ["requests", requests],
    ] as const) {
      if (
        waitingOn.includes(source) &&
        query.hasNextPage &&
        !query.isFetchingNextPage
      ) {
        void query.fetchNextPage();
      }
    }
  };

  const [clearing, setClearing] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">Activity</h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <LockSimpleIcon className="size-3.25 shrink-0" />
          {`${APP_NAME} keeps a history of what you do in it on this computer.`}
        </p>
      </div>
      <div
        className="mt-5 flex min-h-8 shrink-0 flex-wrap items-center gap-2"
        {...settingAnchor("activity-history")}
      >
        <Tabs
          onValueChange={(value) => {
            const next = ACTIVITY_VIEWS.find((each) => each === value);
            if (next) {
              setView(next);
            }
          }}
          value={view}
        >
          <TabsList className="h-8 bg-foreground/8 p-0.5">
            {ACTIVITY_VIEWS.map((each) => (
              <TabsTrigger
                className="h-7 px-2.5 text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs dark:data-[state=active]:border-transparent"
                key={each}
                value={each}
              >
                {VIEW_LABELS[each]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        <ChatsSwitch />
        <Button
          disabled={empty}
          onClick={() => {
            void rpcClient.activity.saveCsv
              .call({ view })
              .then(({ status }) => {
                if (status === "failed") {
                  toast.error("The file couldn't be saved.");
                }
              });
          }}
          size="sm"
          variant="outline"
        >
          <DownloadSimpleIcon />
          Export CSV
        </Button>
        <Button
          onClick={() => {
            setClearing(true);
          }}
          size="sm"
          variant="outline"
        >
          Clear activity…
        </Button>
        <ClearActivityDialog
          onCleared={() => {
            void queryClient.resetQueries({ queryKey: ACTIONS_KEY });
            void queryClient.resetQueries({ queryKey: REQUESTS_KEY });
          }}
          onOpenChange={setClearing}
          open={clearing}
        />
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        {empty ? (
          <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
            {EMPTY[view]}
          </div>
        ) : (
          <TimelineList
            hasMore={waitingOn.length > 0}
            // Days are named from when the section opened, as both logs are read.
            items={withDayHeads(entries, new Date(until), displayLocale)}
            // A fresh list per view, so no row keeps the height of the one
            // another view had at its place.
            key={view}
            loadMore={loadMore}
            onOpenTurn={onOpenTurn}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Whether chats may read what the person did, as a switch in the toolbar,
 * with what a chat gets behind its ⓘ.
 */
function ChatsSwitch() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setShare = useMutation(
    rpcClient.preferences.setShareActionsWithChats.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change that setting", { cause: error });
      },
    }),
  );
  const on = preferences?.shareActionsWithChats !== false;
  return (
    <div
      className="flex items-center gap-2 pr-2 text-sm"
      {...settingAnchor("share-activity")}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            aria-label="More info"
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            type="button"
          >
            <InfoIcon className="size-3.75" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-75 text-[13px] leading-4.5 text-muted-foreground"
        >
          Each message you send includes a short list of what you just did here,
          without names. A chat looks up a name when it needs one.
        </PopoverContent>
      </Popover>
      <label className="flex items-center gap-2">
        Chats can see this
        <Switch
          checked={on}
          disabled={setShare.isPending}
          onCheckedChange={(enabled) => {
            setShare.mutate({ enabled });
          }}
        />
      </label>
    </div>
  );
}

function TimelineList({
  hasMore,
  items,
  loadMore,
  onOpenTurn,
}: {
  hasMore: boolean;
  items: TimelineItem[];
  loadMore: () => void;
  onOpenTurn: (turn: Turn) => void;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const modelName = useModelName();
  const placeGestures = usePlaceGestures();
  const words = { trash: osConventions().trash };

  // Every item is one of two fixed heights, so only the scrollport is
  // measured, in layout px: inside the window's CSS `zoom` the default reads
  // the on-screen rect.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) =>
      items[index]?.kind === "day" ? DAY_HEIGHT : ROW_HEIGHT,
    getItemKey: (index) => items[index]?.id ?? index,
    getScrollElement: () => scroller,
    observeElementRect: (instance, callback) => {
      const element = instance.scrollElement;
      if (!element) {
        return;
      }
      const measure = () => {
        callback({ height: element.offsetHeight, width: element.offsetWidth });
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    },
    overscan: 12,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const last = virtualItems.at(-1);
  useEffect(() => {
    if (hasMore && (last === undefined || last.index >= items.length - 20)) {
      loadMore();
    }
  }, [hasMore, items.length, last, loadMore]);

  return (
    <div className="h-full overflow-y-auto px-1.5 py-1" ref={setScroller}>
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtual) => {
          const item = items[virtual.index];
          if (!item) {
            return null;
          }
          const style = { height: virtual.size, top: virtual.start };
          if (item.kind === "day") {
            return (
              <div
                className="absolute inset-x-0 flex items-end px-3 pb-1 text-xs font-medium text-muted-foreground"
                key={item.id}
                style={style}
              >
                {item.label}
              </div>
            );
          }
          if (item.kind === "turn") {
            const text = turnText(item.turn, modelName);
            return (
              <Row
                at={item.at}
                icon={
                  <ConnectionMark
                    className="size-4"
                    type={leadOf(item.turn)?.connectionType ?? null}
                  />
                }
                key={item.id}
                onClick={() => {
                  onOpenTurn(item.turn);
                }}
                style={style}
                text={text}
              />
            );
          }
          const gestures = placeGestures(placeOf(item.action));
          return (
            <Row
              at={item.at}
              icon={<ActionIcon action={item.action} />}
              key={item.id}
              style={style}
              text={actionText(item.action, words)}
              {...gestures}
            />
          );
        })}
      </div>
    </div>
  );
}

/** One row: the time, the kind's mark, and its two lines. A row that opens something is a button. */
function Row({
  at,
  icon,
  style,
  text,
  ...gestures
}: {
  at: number;
  icon: ReactNode;
  onAuxClick?: (event: React.MouseEvent) => void;
  onClick?: (event: React.MouseEvent) => void;
  onMouseDown?: (event: React.MouseEvent) => void;
  style: { height: number; top: number };
  text: { primary: string; secondary: string };
}) {
  const body = (
    <>
      <span className="w-16 shrink-0 self-start pt-0.5 text-right text-[13px] leading-5 text-muted-foreground tabular-nums">
        {timeFormat.format(at)}
      </span>
      <span className="grid size-5 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-5">{text.primary}</span>
        <span className="block truncate text-xs leading-4 text-muted-foreground">
          {text.secondary}
        </span>
      </span>
    </>
  );
  const className =
    "absolute inset-x-0 flex items-center gap-3 rounded-lg px-3 text-left";
  if (!gestures.onClick) {
    return (
      <div className={className} style={style}>
        {body}
      </div>
    );
  }
  return (
    <button
      className={cn(className, "hover:bg-foreground/5")}
      style={style}
      type="button"
      {...gestures}
    >
      {body}
    </button>
  );
}

/**
 * What a click on a place does from Settings: a folder, file or chat opens
 * where the window opens one, a page in the app's browser, and Settings
 * closes so it is in view. A Cmd-click opens it in a tab of its own.
 */
function usePlaceGestures() {
  const gesturesFor = useGesturesFor();
  const appWindow = useContext(WindowContext);
  const closeSettings = useSetAtom(settingsModalAtom);
  return (target: OpenTarget | undefined) => {
    if (target === undefined) {
      return {};
    }
    if (target.kind === "page") {
      return appWindow
        ? openClickGestures({
            open: () => {
              appWindow.openPage(target.url);
              closeSettings(null);
            },
            openInNewTab: () => {
              appWindow.openPage(target.url, { behind: true, newTab: true });
              closeSettings(null);
            },
          })
        : {};
    }
    const { primary, separate } = gesturesFor(target);
    if (!primary) {
      return {};
    }
    return openClickGestures({
      open: () => {
        primary.run();
        closeSettings(null);
      },
      openInNewTab: () => {
        (separate ?? primary).run();
        closeSettings(null);
      },
    });
  };
}

const ICON_CLASS = "size-4.5 text-foreground/60";

/** The mark for what the person did. */
function ActionIcon({ action }: { action: ShownAction }) {
  switch (action.kind) {
    case "app": {
      return <PlugsIcon className={ICON_CLASS} />;
    }
    case "chat": {
      return <ChatCircleIcon className={ICON_CLASS} />;
    }
    case "copy": {
      return <CopyIcon className={ICON_CLASS} />;
    }
    case "download": {
      return <DownloadSimpleIcon className={ICON_CLASS} />;
    }
    case "edit": {
      return <PencilSimpleIcon className={ICON_CLASS} />;
    }
    case "error": {
      return <WarningCircleIcon className={ICON_CLASS} />;
    }
    case "file": {
      return <FileIcon className={ICON_CLASS} />;
    }
    case "folder": {
      return <FolderIcon className={ICON_CLASS} />;
    }
    case "move": {
      return <ArrowBendDownRightIcon className={ICON_CLASS} />;
    }
    case "new-folder": {
      return <FolderPlusIcon className={ICON_CLASS} />;
    }
    case "open-with": {
      return <ArrowSquareOutIcon className={ICON_CLASS} />;
    }
    case "page": {
      return <GlobeIcon className={ICON_CLASS} />;
    }
    case "permission": {
      return <ShieldCheckIcon className={ICON_CLASS} />;
    }
    case "rename": {
      return <TextboxIcon className={ICON_CLASS} />;
    }
    case "screen": {
      return <AppWindowIcon className={ICON_CLASS} />;
    }
    case "setting": {
      return <GearSixIcon className={ICON_CLASS} />;
    }
    case "trash": {
      return <TrashIcon className={ICON_CLASS} />;
    }
    case "update": {
      return <ArrowCircleUpIcon className={ICON_CLASS} />;
    }
  }
}
