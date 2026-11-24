import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { ActivityDetails } from "@/client/components/activity/activity-details";
import {
  EntryIcon,
  MakerMark,
} from "@/client/components/activity/activity-icons";
import {
  ACTIONS_KEY,
  REQUESTS_KEY,
} from "@/client/components/activity/activity-keys";
import { useModelName } from "@/client/components/activity/activity-requests";
import {
  acrossSeam,
  dayLabel,
  type ActivityRequest,
  type ActivityView,
  entriesShown,
  entryText,
  moreFromOf,
  placeOf,
  timelineOf,
  type TimelineEntry,
  type TimelineItem,
  turnPlaceOf,
  pathOfAction,
  turnParts,
  untilAfterLive,
  withDayHeads,
} from "@/client/components/activity/activity-timeline";
import { type Show } from "@/shared/history-show";
import { ClearActivityDialog } from "@/client/components/activity/clear-activity-dialog";
import { HistoryPlaces } from "@/client/components/activity/history-places";
import {
  ClosedGroupDays,
  RecentlyClosedCards,
  useClosedGroups,
} from "@/client/components/activity/recently-closed";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { SearchField } from "@/client/components/window/search-field";
import {
  refreshWhileShown,
  useIsActiveTab,
} from "@/client/hooks/use-active-tab";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { PAGE_FOLD_PX, useIsNarrower } from "@/client/hooks/use-is-narrower";
import { displayLocale } from "@/client/lib/display-locale";
import { type OpenTarget } from "@/client/lib/open-target";
import { toast } from "@/client/lib/toast";
import { cn, commandKeyHeld, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { BroomIcon } from "@phosphor-icons/react/Broom";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { PauseCircleIcon } from "@phosphor-icons/react/PauseCircle";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useEffect, useState } from "react";

/** How many of each log one read takes. */
const PAGE_SIZE = 200;

/** How often what happened since the page opened is read while its tab is up. */
const LIVE_MS = 5000;

/**
 * The most of each log the live read takes. A read that comes back with this
 * many moves the end of the paged history up to when it was read, so the
 * history takes those rows and the live read starts after them.
 */
const LIVE_LIMIT = 200;

/** What each filter says with nothing in it yet. */
const EMPTY: Record<"all" | Show, { line: string; title: string }> = {
  ai: {
    line: "When a chat uses AI, the model it used shows up here.",
    title: "No AI usage yet",
  },
  all: {
    line: `What you do in ${APP_NAME} shows up here.`,
    title: "No history yet",
  },
  changes: {
    line: "Files you edit or move and settings you change show up here.",
    title: "No changes yet",
  },
  chats: { line: "Chats you open show up here.", title: "No chats yet" },
  closed: {
    line: "Tab groups you close show up here.",
    title: "No closed tab groups",
  },
  files: { line: "Files you open show up here.", title: "No files yet" },
  pages: { line: "Websites you visit show up here.", title: "No websites yet" },
};

const timeFormat = new Intl.DateTimeFormat(displayLocale, {
  hour: "numeric",
  minute: "2-digit",
});

/** Which of the two logs a filter reads. */
function viewOf(show: Show | undefined): ActivityView {
  if (show === undefined) {
    return "all";
  }
  return show === "ai" ? "ai" : "yours";
}

/** Whether an infinite query has read all there is, or will read no more. */
function isComplete<T>(query: UseInfiniteQueryResult<InfiniteData<T>>) {
  return query.isError || (query.isSuccess && !query.hasNextPage);
}

/** Whether an infinite query has its own read in, where the rows kept from the read before it are not. */
function isIn<T>(query: UseInfiniteQueryResult<InfiniteData<T>>) {
  return !query.isPending && !query.isPlaceholderData;
}

/** What a removal takes from the logs: the person's own rows, and the AI requests of the turns picked. */
function removalOf(entries: readonly TimelineEntry[]) {
  return {
    actions: entries.flatMap((entry) =>
      entry.kind === "action" && entry.action.kind !== "permission"
        ? [entry.action]
        : [],
    ),
    requests: entries.flatMap((entry) =>
      entry.kind === "turn"
        ? entry.turn.requests.map((request) => request.id)
        : [],
    ),
  };
}

/** Whether a row can come out of History: a permission answered is its chat's rule, which stays. */
function isRemovable(entry: TimelineEntry) {
  return entry.kind !== "action" || entry.action.kind !== "permission";
}

/**
 * History: what the person did in the app and the AI its chats used, newest
 * first, a card per day and a line per thing, the way a browser's history
 * reads. A search and a list of kinds narrow it, and over everything are the
 * tab groups closed last, which the list's last place has all of. A row
 * picked shows its details over the list, so the rows keep their width and
 * their place.
 *
 * Both logs stay on this computer: the person's in the workspace's machine
 * folder (`docs/architecture/action-log.md`), the requests in the
 * workspace's own records (`packages/workspace/src/lib/activity/record.ts`).
 * Saving a CSV is the only way either leaves, and the person does that.
 */
export function ActivityPage({
  onSearch,
  q,
  show,
}: {
  onSearch: (next: { q?: string; show?: Show | undefined }) => void;
  q: string;
  show: Show | undefined;
}) {
  // Both logs are paged up to `until`, when the page opened or a live read
  // last came back full, so what is recorded while it is open never shifts
  // a page; what comes after is read on its own every few seconds while the
  // tab is up, and goes on top.
  const [until, setUntil] = useState(() => Date.now());
  // What the live reads start after: `until`, once the history up to it is
  // in. While a later `until` loads, they stay after the one before it, so
  // the rows the history is about to take stay listed.
  const [liveSince, setLiveSince] = useState(until);
  const isShown = useIsActiveTab();
  const view = viewOf(show);
  const queryClient = useQueryClient();
  const modelName = useModelName();
  const words = { trash: osConventions().trash };

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
    // A new `until` reads afresh behind what is shown, so the list keeps
    // its rows and its place meanwhile.
    placeholderData: keepPreviousData,
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
    // A new `until` reads afresh behind what is shown, so the list keeps
    // its rows and its place meanwhile.
    placeholderData: keepPreviousData,
  });

  const newerActions = useQuery({
    ...rpcClient.actions.list.queryOptions({
      input: { limit: LIVE_LIMIT, since: liveSince + 1 },
    }),
    ...refreshWhileShown(isShown && view !== "ai", LIVE_MS),
    placeholderData: keepPreviousData,
  });
  const newerRequests = useQuery({
    ...rpcClient.workspace.activity.list.queryOptions({
      input: {
        filter: { since: liveSince + 1 },
        limit: LIVE_LIMIT,
        offset: 0,
        sort: { column: "startedAt", direction: "desc" },
      },
    }),
    ...refreshWhileShown(isShown && view !== "yours", LIVE_MS),
    placeholderData: keepPreviousData,
  });

  // The live reads' rows, counted only once they are of what came after
  // `until`: not while a later `until` loads, and not the rows kept from the
  // read before.
  const nextUntil = untilAfterLive({
    limit: LIVE_LIMIT,
    reads: [
      {
        count:
          liveSince === until && !newerActions.isPlaceholderData
            ? (newerActions.data?.actions.length ?? 0)
            : 0,
        readAt: newerActions.dataUpdatedAt,
      },
      {
        count:
          liveSince === until && !newerRequests.isPlaceholderData
            ? (newerRequests.data?.length ?? 0)
            : 0,
        readAt: newerRequests.dataUpdatedAt,
      },
    ],
    until,
  });
  if (nextUntil !== until) {
    setUntil(nextUntil);
  }
  if (
    liveSince !== until &&
    (view === "ai" || isIn(actions)) &&
    (view === "yours" || isIn(requests))
  ) {
    setLiveSince(until);
  }

  const closed = useClosedGroups();
  const { entries, waitingOn } = timelineOf({
    actions: {
      complete: isComplete(actions),
      items: acrossSeam({
        history: actions.data?.pages.flatMap((page) => page.actions) ?? [],
        // Rows kept from the read before were read up to the `until` before.
        historyUntil: actions.isPlaceholderData ? liveSince : until,
        live: newerActions.data?.actions ?? [],
        timeOf: (action) => Date.parse(action.at),
      }),
    },
    requests: {
      complete: isComplete(requests),
      items: acrossSeam({
        history: requests.data?.pages.flat() ?? [],
        historyUntil: requests.isPlaceholderData ? liveSince : until,
        live: newerRequests.data ?? [],
        timeOf: (request) => request.startedAt,
      }),
    },
    view,
  });
  const shown = entriesShown(entries, { modelName, q, show, words });
  const isLoading = waitingOn.length > 0;

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

  // The row whose details are open, by its id.
  const [pickedId, pick] = useState<string | undefined>();
  const picked = shown.find((entry) => entry.id === pickedId);
  const narrow = (next: Parameters<typeof onSearch>[0]) => {
    pick(undefined);
    onSearch(next);
  };
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const checkedEntries = shown.filter((entry) => checked.has(entry.id));
  const [clearing, setClearing] = useState(false);

  // Read again from now, so what was taken out is gone and anything new is in.
  const startOver = () => {
    void queryClient.resetQueries({ queryKey: ACTIONS_KEY });
    void queryClient.resetQueries({ queryKey: REQUESTS_KEY });
    const now = Date.now();
    setUntil(now);
    setLiveSince(now);
  };

  const remove = useMutation(
    rpcClient.activity.remove.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't remove that from History", { cause: error });
      },
      onSuccess: ({ requestsKept }) => {
        setChecked(new Set());
        pick(undefined);
        startOver();
        if (requestsKept > 0) {
          toast(
            "AI usage from your other computers can only be removed there.",
          );
        }
      },
    }),
  );
  const removeEntries = (removed: readonly TimelineEntry[]) => {
    const taken = removed.filter(isRemovable);
    if (taken.length > 0) {
      remove.mutate(removalOf(taken));
    } else {
      setChecked(new Set());
      pick(undefined);
    }
  };

  const preferences = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const isKeeping = preferences.data?.keepHistory !== false;
  const turnOn = useMutation(
    rpcClient.preferences.setKeepHistory.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't turn the history back on", { cause: error });
      },
    }),
  );

  const empty = shown.length === 0 && !isLoading;
  const isMixed = show === undefined;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const closedGroups = closed
    .filter(({ words: found }) => terms.every((term) => found.includes(term)))
    .map(({ group }) => group);
  // A search is of the rows, so the groups stand aside for it.
  const cards =
    isMixed && terms.length === 0 && closedGroups.length > 0 ? (
      <RecentlyClosedCards groups={closedGroups} />
    ) : null;
  // The list of kinds folds to pills over the rows, and the details come up
  // from the bottom, by the room each has.
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const isNarrow = useIsNarrower(frame, PAGE_FOLD_PX);
  const [listFrame, setListFrame] = useState<HTMLDivElement | null>(null);
  const isListNarrow = useIsNarrower(listFrame, PAGE_FOLD_PX);
  const details = picked ? (
    <ActivityDetails
      entry={picked}
      key={picked.id}
      onClose={() => {
        pick(undefined);
      }}
      onRemove={
        isRemovable(picked)
          ? () => {
              removeEntries([picked]);
            }
          : undefined
      }
    />
  ) : null;
  // The start of the day of the latest read, so the days are worked out
  // again only when the day changes.
  const today = new Date(
    Math.max(until, newerActions.dataUpdatedAt, newerRequests.dataUpdatedAt),
  ).setHours(0, 0, 0, 0);

  return (
    <div
      className="@container/activity flex h-full min-h-0 flex-col bg-background"
      ref={setFrame}
    >
      {/* One bar: the page's name, its search, and its menu. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 @min-[640px]/activity:px-6">
        <h1 className="mr-1 text-base font-semibold">History</h1>
        {checkedEntries.length > 0 ? (
          <div
            className={cn(
              "flex h-9 min-w-0 flex-1 items-center gap-3 rounded-lg bg-foreground/6 px-3 text-sm",
              UNDER_TITLE_WHEN_NARROW,
            )}
          >
            <span className="font-medium">
              {`${checkedEntries.length} selected`}
            </span>
            <span className="flex-1" />
            <Button
              onClick={() => {
                setChecked(new Set());
              }}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={remove.isPending}
              onClick={() => {
                removeEntries(checkedEntries);
              }}
              size="sm"
              variant="destructive"
            >
              Remove from History
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-center gap-3",
              UNDER_TITLE_WHEN_NARROW,
            )}
          >
            <div className="flex w-64 max-w-full">
              <SearchField
                onChange={(value) => {
                  narrow({ q: value });
                }}
                placeholder="Search history"
                value={q}
              />
            </div>
          </div>
        )}
        <span className="flex-1" />

        <PageMenu
          onClear={() => {
            setClearing(true);
          }}
          onExport={
            // The closed groups are no record to save.
            show === "closed"
              ? undefined
              : () => {
                  void rpcClient.activity.saveCsv
                    .call(show === undefined ? {} : { show })
                    .then(({ status }) => {
                      if (status === "failed") {
                        toast.error("The file couldn't be saved.");
                      }
                    });
                }
          }
        />
      </div>
      {isKeeping ? null : (
        <div className="mx-4 mt-4 flex shrink-0 items-center gap-3 rounded-xl bg-foreground/5 px-4 py-2.5 text-sm @min-[640px]/activity:mx-6">
          <PauseCircleIcon className="size-4.5 shrink-0 text-foreground/70" />
          <span className="flex-1">
            {`${APP_NAME} isn't keeping a history right now.`}
          </span>
          <Button
            disabled={turnOn.isPending}
            onClick={() => {
              turnOn.mutate({ enabled: true });
            }}
            size="sm"
            variant="outline"
          >
            Turn on
          </Button>
        </div>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1",
          isNarrow ? "flex-col" : "flex-row",
        )}
      >
        <HistoryPlaces
          closedCount={closed.length}
          isNarrow={isNarrow}
          onShow={(next) => {
            narrow({ show: next });
          }}
          show={show}
        />
        <div
          className="@container/list relative flex min-h-0 min-w-0 flex-1"
          ref={setListFrame}
        >
          {show === "closed" ? (
            closedGroups.length === 0 ? (
              <Empty q={q} show={show} />
            ) : (
              <div className={cn(LIST_PANE, "py-4")}>
                <ClosedGroupDays
                  dayOf={(at) => dayLabel(at, new Date(today), displayLocale)}
                  groups={closedGroups}
                />
              </div>
            )
          ) : empty ? (
            cards ? (
              <div className={cn(LIST_PANE, "flex flex-col py-4")}>
                {cards}
                <Empty q={q} show={show} />
              </div>
            ) : (
              <Empty q={q} show={show} />
            )
          ) : (
            <ActivityList
              cards={cards}
              checked={checked}
              hasMore={isLoading}
              isBottomCovered={isListNarrow && details !== null}
              isMixed={isMixed}
              // Days are named from the latest read, which the live reads keep
              // within `LIVE_MS` of the clock while the tab is up.
              items={withDayHeads(shown, new Date(today), displayLocale)}
              loadMore={loadMore}
              onCheck={(entry, on) => {
                setChecked((current) => {
                  const next = new Set(current);
                  if (on) {
                    next.add(entry.id);
                  } else {
                    next.delete(entry.id);
                  }
                  return next;
                });
              }}
              onMoreFrom={(found) => {
                narrow({ q: found });
              }}
              onPick={(entry) => {
                pick(entry?.id);
              }}
              onRemove={(entry) => {
                removeEntries([entry]);
              }}
              picked={picked?.id ?? null}
            />
          )}
          {details ? (
            <FloatingDetails isSheet={isListNarrow}>{details}</FloatingDetails>
          ) : null}
        </div>
      </div>
      <ClearActivityDialog
        onCleared={startOver}
        onOpenChange={setClearing}
        open={clearing}
      />
    </div>
  );
}

/** What each thing in the list is taken to be tall until it is measured. */
const ESTIMATED_HEIGHT = { action: 40, cards: 110, day: 44, turn: 40 };

/** The rows' own scrollport. */
const LIST_PANE =
  "min-h-0 min-w-0 flex-1 overflow-y-auto px-4 @min-[640px]/activity:px-6";

/** The part of the list's height its details take where they come up from the bottom. */
const SHEET_HEIGHT = 0.55;

/** How long the details let the pointer through after they come up. */
const DOUBLE_CLICK_MS = 500;

/**
 * The details over the list, at its right end, or along its bottom where it
 * is too narrow for that. They come up under the pointer that picked the row,
 * so at first a press goes through them: a double click's second press lands
 * on the row it began on.
 */
function FloatingDetails({
  children,
  isSheet,
}: {
  children: React.ReactNode;
  isSheet: boolean;
}) {
  const [isPressable, setPressable] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setPressable(true);
    }, DOUBLE_CLICK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 flex animate-in duration-150 ease-out fade-in-0 motion-reduce:animate-none",
        isSheet
          ? "inset-x-0 bottom-0 p-3 slide-in-from-bottom-2"
          : "inset-y-0 right-0 w-106 py-4 pr-6 slide-in-from-right-2",
      )}
      style={isSheet ? { height: `${SHEET_HEIGHT * 100}%` } : undefined}
    >
      <div
        className={cn(
          "flex min-h-0 w-full rounded-xl shadow-float-lg",
          isPressable && "pointer-events-auto",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** What a list with nothing in it says, in its middle. */
function Empty({ q, show }: { q: string; show: Show | undefined }) {
  const { line, title } = EMPTY[show ?? "all"];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      {q ? (
        <p className="text-sm text-muted-foreground">{`Nothing matches “${q}”.`}</p>
      ) : (
        <>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-[13px] text-muted-foreground">{line}</p>
        </>
      )}
    </div>
  );
}

/**
 * Where the bar's search, or what is selected, go on a page too
 * narrow for one line: under the title and the page's ⋯, a line of their own.
 */
const UNDER_TITLE_WHEN_NARROW =
  "@max-[640px]/activity:order-last @max-[640px]/activity:basis-full";

/** The page's ⋯: what is done with the whole history, and where its settings are. */
function PageMenu({
  onClear,
  onExport,
}: {
  onClear: () => void;
  onExport: (() => void) | undefined;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="More" size="icon-sm" variant="ghost">
          <DotsThreeIcon className="size-4.5" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem
          disabled={onExport === undefined}
          {...(onExport ? { onSelect: onExport } : {})}
        >
          <DownloadSimpleIcon className="size-4" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            openSettings({ tab: "Activity" });
          }}
        >
          <GearSixIcon className="size-4" />
          History Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openClearBrowsingData}>
          <BroomIcon className="size-4" />
          Clear Browsing Data
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onClear}>
          <TrashIcon className="size-4" />
          {`Clear ${APP_NAME} History`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Where a row opens, if anywhere. */
function targetOf(entry: TimelineEntry): OpenTarget | undefined {
  return entry.kind === "turn"
    ? turnPlaceOf(entry.turn)
    : placeOf(entry.action);
}

/**
 * The days, each a card of rows, drawn only where the list is scrolled to.
 * Each item is measured as it is drawn, so a day's head and its rows take
 * the room they really have.
 */
function ActivityList({
  checked,
  cards,
  hasMore,
  isBottomCovered,
  isMixed,
  items: listed,
  loadMore,
  onCheck,
  onMoreFrom,
  onPick,
  onRemove,
  picked,
}: {
  checked: ReadonlySet<string>;
  /** The closed groups over the rows, which scroll with them. */
  cards: React.ReactNode;
  hasMore: boolean;
  /** Whether the details cover the list's lower part, which the rows then clear. */
  isBottomCovered: boolean;
  /** Whether the rows are of every kind. */
  isMixed: boolean;
  items: TimelineItem[];
  loadMore: () => void;
  onCheck: (entry: TimelineEntry, on: boolean) => void;
  onMoreFrom: (q: string) => void;
  onPick: (entry: TimelineEntry | undefined) => void;
  onRemove: (entry: TimelineEntry) => void;
  picked: null | string;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const items: ({ id: string; kind: "cards" } | TimelineItem)[] = cards
    ? [{ id: "cards", kind: "cards" }, ...listed]
    : listed;
  const modelName = useModelName();
  const gesturesFor = useGesturesFor();
  const words = { trash: osConventions().trash };

  // Room for the rows to scroll clear of the details over them.
  const bottomRoom =
    isBottomCovered && scroller
      ? scroller.offsetHeight * SHEET_HEIGHT + 16
      : 16;

  // Measured in layout px: inside the window's CSS `zoom` the default reads
  // the on-screen rect.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) => ESTIMATED_HEIGHT[items[index]?.kind ?? "action"],
    getItemKey: (index) => items[index]?.id ?? index,
    getScrollElement: () => scroller,
    measureElement: (element) =>
      element instanceof HTMLElement ? element.offsetHeight : 0,
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
    paddingEnd: bottomRoom,
    paddingStart: 16,
    scrollPaddingEnd: bottomRoom,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const last = virtualItems.at(-1);
  useEffect(() => {
    if (hasMore && (last === undefined || last.index >= items.length - 20)) {
      loadMore();
    }
  }, [hasMore, items.length, last, loadMore]);

  const entries = listed.filter(
    (item): item is TimelineEntry => item.kind !== "day",
  );

  // The arrows walk the rows, Return opens the one picked, Escape lets it go.
  const onKeyDown = (event: KeyboardEvent) => {
    // A row's own box and ⋮ answer their keys themselves.
    if (event.target !== event.currentTarget) {
      return;
    }
    const at = entries.findIndex((entry) => entry.id === picked);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        entries[
          at === -1
            ? 0
            : Math.min(
                entries.length - 1,
                Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)),
              )
        ];
      if (next) {
        onPick(next);
        virtualizer.scrollToIndex(items.indexOf(next), { align: "auto" });
      }
    } else if (event.key === "Enter" && at !== -1) {
      const entry = entries[at];
      const target = entry ? targetOf(entry) : undefined;
      if (target) {
        event.preventDefault();
        gesturesFor(target).primary?.run();
      }
    } else if (event.key === "Escape" && picked !== null) {
      event.preventDefault();
      onPick(undefined);
    }
  };

  // A row's menu, the same under ⋮ and a right click: where it opens, a
  // file's or folder's path (where the place's own Copy would give the
  // app's link to it), More from, and Remove.
  const menuOf = (entry: TimelineEntry): RowMenuItem[] => {
    const target = targetOf(entry);
    const path =
      entry.kind === "action" ? pathOfAction(entry.action) : undefined;
    const opens = (target ? gesturesFor(target).destinations : []).filter(
      (destination) => path === undefined || destination.id !== "copy",
    );
    const more = moreFromOf(entry);
    return [
      ...opens.map((destination) => ({
        label: destination.label,
        run: destination.run,
      })),
      ...(path === undefined
        ? []
        : [
            {
              label: "Copy Path",
              run: () => {
                void navigator.clipboard.writeText(path);
              },
            },
          ]),
      ...(more
        ? [
            {
              label: `More from ${more.label}`,
              run: () => {
                onMoreFrom(more.q);
              },
            },
          ]
        : []),
      ...(isRemovable(entry)
        ? [
            "separator" as const,
            {
              destructive: true,
              label: "Remove from History",
              run: () => {
                onRemove(entry);
              },
            },
          ]
        : []),
    ];
  };

  return (
    <div
      className={cn(LIST_PANE, "outline-none")}
      data-keyboard-home
      onKeyDown={onKeyDown}
      ref={setScroller}
      tabIndex={0}
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtual) => {
          const item = items[virtual.index];
          if (!item) {
            return null;
          }
          const next = items[virtual.index + 1];
          const endsDay = next === undefined || next.kind === "day";
          const placed = {
            "data-index": virtual.index,
            ref: virtualizer.measureElement,
            style: { transform: `translateY(${virtual.start}px)` },
          };
          if (item.kind === "cards") {
            return (
              <div
                className="absolute inset-x-0 top-0"
                key={item.id}
                {...placed}
              >
                {cards}
              </div>
            );
          }
          if (item.kind === "day") {
            return (
              <div
                className={cn(
                  "absolute inset-x-0 top-0",
                  items[virtual.index - 1] !== undefined &&
                    items[virtual.index - 1]?.kind !== "cards" &&
                    "pt-3",
                )}
                key={item.id}
                {...placed}
              >
                <div className="rounded-t-xl border-x border-t border-border bg-card px-4.5 pt-3 pb-2 text-sm font-medium">
                  {item.label}
                </div>
              </div>
            );
          }
          const text = entryText(item, { isMixed, modelName, words });
          const context =
            item.kind === "turn" && !isMixed ? (
              <TurnContext parts={turnParts(item.turn, modelName)} />
            ) : (
              text.context
            );
          const target = targetOf(item);
          return (
            <div className="absolute inset-x-0 top-0" key={item.id} {...placed}>
              <div
                className={cn(
                  "border-x border-border bg-card px-2",
                  endsDay && "rounded-b-xl border-b pb-2",
                )}
              >
                <ActivityRow
                  at={item.at}
                  checked={checked.has(item.id)}
                  context={context}
                  icon={<EntryIcon entry={item} isMixed={isMixed} />}
                  isPicked={picked === item.id}
                  onCheck={(on) => {
                    onCheck(item, on);
                  }}
                  menu={menuOf(item)}
                  onOpen={({ newTab }) => {
                    if (!target) {
                      return;
                    }
                    const gestures = gesturesFor(target);
                    if (newTab) {
                      gestures.separate?.run();
                    } else {
                      gestures.primary?.run();
                    }
                  }}
                  onPick={() => {
                    onPick(picked === item.id ? undefined : item);
                  }}
                  title={text.title}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One thing on one line, the way a browser's history lists a page: a box
 * to pick it with, the time, its mark, what it names, what was done with
 * it, and its ⋮. A click shows its details and a double click opens it.
 */
function ActivityRow({
  at,
  checked,
  context,
  icon,
  isPicked,
  menu,
  onCheck,
  onOpen,
  onPick,
  title,
}: {
  at: number;
  checked: boolean;
  context: React.ReactNode;
  icon: React.ReactNode;
  isPicked: boolean;
  /** What its ⋮ and a right click offer. */
  menu: RowMenuItem[];
  onCheck: (on: boolean) => void;
  /** Opens it where the page opens things, or in a tab of its own. */
  onOpen: (how: { newTab: boolean }) => void;
  onPick: () => void;
  title: string;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          aria-selected={isPicked}
          className={cn(
            "group/row flex min-h-10 cursor-default items-center gap-3 rounded-lg px-2.5 select-none",
            ENTRY_ROW,
            isPicked ? "bg-foreground/8" : "hover:bg-foreground/5",
          )}
          onAuxClick={(event) => {
            if (event.button === 1) {
              onOpen({ newTab: true });
            }
          }}
          onClick={(event) => {
            if (commandKeyHeld(event)) {
              onOpen({ newTab: true });
            } else if (event.detail <= 1) {
              // A second press is a double click's, which opens the row.
              onPick();
            }
          }}
          onDoubleClick={() => {
            onOpen({ newTab: false });
          }}
          role="option"
        >
          {/* The whole gutter around the box ticks it, so a click a little
        off the box never picks the row instead. */}
          <span
            className="-my-1 -ml-2.5 grid shrink-0 place-items-center self-stretch pr-1 pl-2.5 @max-[16rem]/entry:hidden"
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) {
                onCheck(!checked);
              }
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
            }}
          >
            <Checkbox
              aria-label={`Select ${title}`}
              checked={checked}
              onCheckedChange={(value) => {
                onCheck(value === true);
              }}
            />
          </span>
          <span
            className={cn(
              "w-16 shrink-0 text-[13px] text-muted-foreground tabular-nums",
              TIME_COLUMN,
            )}
          >
            {timeFormat.format(at)}
          </span>
          <span className="grid size-5 shrink-0 place-items-center">
            {icon}
          </span>
          <EntryWords at={at} context={context} title={title} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="More"
                className={cn(
                  "shrink-0 text-foreground/60 data-[state=open]:opacity-100 @max-[16rem]/entry:hidden",
                  isPicked
                    ? ""
                    : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                }}
                size="icon-sm"
                variant="ghost"
              >
                <DotsThreeVerticalIcon className="size-4" weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <RowMenu components={dropdownMenuComponents} items={menu} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <RowMenu components={contextMenuComponents} items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * A row of History's is a container its words and its time answer to:
 * on one line where there is room, and where there is not, the time leaves
 * its own column for the line under the name. The narrowest page rows
 * leave out the box and the ⋮ too, for the words; a right click and the
 * details still have what the ⋮ has.
 */
const ENTRY_ROW = "@container/entry";

/** The time's own column, on a row with room for one line. */
const TIME_COLUMN = "@max-[30rem]/entry:hidden";

/**
 * What a row names and what was done with it, and when on a narrow row: on
 * one line where there is room, the name cut short first, and on two where
 * there is not.
 */
function EntryWords({
  at,
  context,
  title,
}: {
  at: number;
  context: React.ReactNode;
  title: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col py-1 leading-5 @min-[30rem]/entry:flex-row @min-[30rem]/entry:items-center @min-[30rem]/entry:gap-3 @min-[30rem]/entry:py-0">
      {title ? (
        <span className="min-w-0 shrink truncate text-sm">{title}</span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
        {context ? <span className="min-w-0 truncate">{context}</span> : null}
        <span className="flex shrink-0 gap-x-1.5 whitespace-nowrap tabular-nums @min-[30rem]/entry:hidden">
          {context ? <span aria-hidden>·</span> : null}
          {timeFormat.format(at)}
        </span>
      </span>
    </span>
  );
}

/** One line of a row's menu, or a rule between groups of them. */
type RowMenuItem =
  | "separator"
  | { destructive?: boolean; label: string; run: () => void };

/** A row's menu, written once for its ⋮ and its right click. */
function RowMenu({
  components: { Item, Separator },
  items,
}: {
  components: MenuComponents;
  items: RowMenuItem[];
}) {
  return items.map((item, index) =>
    item === "separator" ? (
      // oxlint-disable-next-line react/no-array-index-key -- a rule has nothing else to go by
      <Separator key={`rule-${index}`} />
    ) : (
      <Item
        key={item.label}
        onSelect={item.run}
        variant={item.destructive ? "destructive" : "default"}
      >
        {item.label}
      </Item>
    ),
  );
}

/** What an AI row did, then its model with the maker's mark, then how many requests. */
function TurnContext({ parts }: { parts: ReturnType<typeof turnParts> }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      {parts.did ? <span className="shrink-0">{parts.did} ·</span> : null}
      {parts.model ? (
        <span className="flex min-w-0 shrink items-center gap-1">
          <MakerMark maker={parts.maker} />
          <span className="truncate">{parts.model}</span>
        </span>
      ) : null}
      <span className="shrink-0">· {parts.requests}</span>
    </span>
  );
}
