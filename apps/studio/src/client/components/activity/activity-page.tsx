import { openSettings } from "@/client/atoms/settings-modal";
import { ActivityDetails } from "@/client/components/activity/activity-details";
import { EntryIcon } from "@/client/components/activity/activity-icons";
import { useModelName } from "@/client/components/activity/activity-requests";
import {
  type ActivityRequest,
  type ActivityView,
  actionText,
  entriesShown,
  moreFromOf,
  placeOf,
  type Show,
  SHOWS,
  timelineOf,
  type TimelineEntry,
  type TimelineItem,
  turnPlaceOf,
  turnText,
  withDayHeads,
} from "@/client/components/activity/activity-timeline";
import { ClearActivityDialog } from "@/client/components/activity/clear-activity-dialog";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { SearchField } from "@/client/components/window/search-field";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { displayLocale } from "@/client/lib/display-locale";
import { type OpenTarget } from "@/client/lib/open-target";
import { toast } from "@/client/lib/toast";
import { cn, commandKeyHeld, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { LockSimpleIcon } from "@phosphor-icons/react/LockSimple";
import { PauseCircleIcon } from "@phosphor-icons/react/PauseCircle";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import {
  type InfiniteData,
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

/** The query keys of the person's actions and the AI requests, which a removal or a Clear starts over. */
export const ACTIONS_KEY = ["actions", "list"];
export const REQUESTS_KEY = ["activity", "timeline"];

/** The filters over the list, in the order they sit, with what each one shows. */
const SHOW_LABELS: Record<Show, { label: string; title: string }> = {
  ai: { label: "AI requests", title: "What your chats asked AI models" },
  chats: { label: "Chats", title: "Chats you opened" },
  files: { label: "Files", title: "Files and folders you opened or changed" },
  pages: { label: "Pages", title: "Pages you visited in the browser" },
};

const EMPTY: Record<Show, string> = {
  ai: "No AI requests yet.",
  chats: "No chats yet.",
  files: "No files yet.",
  pages: "No pages yet.",
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

/** What a removal takes: the person's own rows, and the AI requests of the turns picked. */
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

/** Whether a row can come out of Activity: a permission answered is its chat's rule, which stays. */
function isRemovable(entry: TimelineEntry) {
  return entry.kind === "turn" || entry.action.kind !== "permission";
}

/**
 * Activity: what the person did in the app and the AI requests its chats
 * made, newest first, a card per day and a line per thing, the way a
 * browser's history reads. A search and a filter narrow it; a row picked
 * shows its details in a card beside the list, so the list keeps its place.
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
  // Both logs are read up to when the page opened, so what is recorded
  // while it is open never shifts a page, and again from then each time
  // its tab comes back up.
  const [until, setUntil] = useState(() => Date.now());
  const isShown = useIsActiveTab();
  const [wasShown, setWasShown] = useState(isShown);
  if (isShown !== wasShown) {
    setWasShown(isShown);
    if (isShown) {
      setUntil(Date.now());
    }
  }
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

  const [pickedId, setPickedId] = useState<null | string>(null);
  const picked = shown.find((entry) => entry.id === pickedId);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const checkedEntries = shown.filter((entry) => checked.has(entry.id));
  const [clearing, setClearing] = useState(false);

  // Read again from now, so what was taken out is gone and anything new is in.
  const startOver = () => {
    void queryClient.resetQueries({ queryKey: ACTIONS_KEY });
    void queryClient.resetQueries({ queryKey: REQUESTS_KEY });
    setUntil(Date.now());
  };

  const remove = useMutation(
    rpcClient.activity.remove.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't remove that from Activity", { cause: error });
      },
      onSuccess: () => {
        setChecked(new Set());
        setPickedId(null);
        startOver();
      },
    }),
  );
  const removeEntries = (removed: readonly TimelineEntry[]) => {
    remove.mutate(removalOf(removed.filter(isRemovable)));
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 space-y-4 border-b border-border px-6 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Activity</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <LockSimpleIcon className="size-3.25 shrink-0" />
              {`${APP_NAME} keeps a history of what you do in it on this computer.`}
            </p>
          </div>
          <PageMenu
            onClear={() => {
              setClearing(true);
            }}
            onExport={() => {
              void rpcClient.activity.saveCsv
                .call({ view })
                .then(({ status }) => {
                  if (status === "failed") {
                    toast.error("The file couldn't be saved.");
                  }
                });
            }}
          />
        </div>
        {checkedEntries.length > 0 ? (
          <div className="flex h-9 items-center gap-3 rounded-lg bg-foreground/6 px-3 text-sm">
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
              Remove from Activity
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-75 shrink-0">
              <SearchField
                onChange={(value) => {
                  onSearch({ q: value });
                }}
                placeholder="Search activity"
                value={q}
              />
            </div>
            <div className="flex items-center gap-1" role="radiogroup">
              {[undefined, ...SHOWS].map((each) => (
                <button
                  aria-checked={show === each}
                  className={cn(
                    "h-7 rounded-full px-3 text-[13px]",
                    show === each
                      ? "bg-foreground text-background"
                      : "text-muted-foreground ring-1 ring-border hover:bg-foreground/5 hover:text-foreground",
                  )}
                  key={each ?? "all"}
                  onClick={() => {
                    setPickedId(null);
                    onSearch({ show: each });
                  }}
                  role="radio"
                  title={
                    each === undefined ? undefined : SHOW_LABELS[each].title
                  }
                  type="button"
                >
                  {each === undefined ? "All" : SHOW_LABELS[each].label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {isKeeping ? null : (
        <div className="mx-6 mt-4 flex shrink-0 items-center gap-3 rounded-xl bg-foreground/5 px-4 py-2.5 text-sm">
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
      <div className="flex min-h-0 flex-1">
        {empty ? (
          <div className="grid flex-1 place-items-center p-6 text-sm text-muted-foreground">
            {q
              ? `Nothing matches “${q}”.`
              : show
                ? EMPTY[show]
                : "What you do in Instrument shows up here."}
          </div>
        ) : (
          <ActivityList
            checked={checked}
            hasMore={isLoading}
            // Days are named from when the page opened, as both logs are read.
            items={withDayHeads(shown, new Date(until), displayLocale)}
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
              setPickedId(null);
              onSearch({ q: found });
            }}
            onPick={(entry) => {
              setPickedId(entry?.id ?? null);
            }}
            onRemove={(entry) => {
              removeEntries([entry]);
            }}
            picked={picked?.id ?? null}
          />
        )}
        {picked ? (
          <div className="flex w-106 shrink-0 py-4 pr-6">
            <ActivityDetails
              entry={picked}
              key={picked.id}
              onClose={() => {
                setPickedId(null);
              }}
              onRemove={
                isRemovable(picked)
                  ? () => {
                      removeEntries([picked]);
                    }
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>
      <ClearActivityDialog
        onCleared={startOver}
        onOpenChange={setClearing}
        open={clearing}
      />
    </div>
  );
}

/** The page's ⋮: what is done with the whole history, and where its settings are. */
function PageMenu({
  onClear,
  onExport,
}: {
  onClear: () => void;
  onExport: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="More" size="icon-sm" variant="ghost">
          <DotsThreeIcon className="size-4.5" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onClear}>
          <TrashIcon className="size-4" />
          Clear activity…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}>
          <DownloadSimpleIcon className="size-4" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            openSettings({ tab: "Activity" });
          }}
        >
          <GearSixIcon className="size-4" />
          Activity settings
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
  hasMore,
  items,
  loadMore,
  onCheck,
  onMoreFrom,
  onPick,
  onRemove,
  picked,
}: {
  checked: ReadonlySet<string>;
  hasMore: boolean;
  items: TimelineItem[];
  loadMore: () => void;
  onCheck: (entry: TimelineEntry, on: boolean) => void;
  onMoreFrom: (q: string) => void;
  onPick: (entry: TimelineEntry | undefined) => void;
  onRemove: (entry: TimelineEntry) => void;
  picked: null | string;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const modelName = useModelName();
  const gesturesFor = useGesturesFor();
  const words = { trash: osConventions().trash };

  // Measured in layout px: inside the window's CSS `zoom` the default reads
  // the on-screen rect.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) => (items[index]?.kind === "day" ? 44 : 40),
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
    paddingEnd: 16,
    paddingStart: 16,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const last = virtualItems.at(-1);
  useEffect(() => {
    if (hasMore && (last === undefined || last.index >= items.length - 20)) {
      loadMore();
    }
  }, [hasMore, items.length, last, loadMore]);

  const entries = items.filter(
    (item): item is TimelineEntry => item.kind !== "day",
  );

  // The arrows walk the rows, Return opens the one picked, Escape lets it go.
  const onKeyDown = (event: KeyboardEvent) => {
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

  const showMenu = async (entry: TimelineEntry) => {
    const target = targetOf(entry);
    const destinations = target ? gesturesFor(target).destinations : [];
    const more = moreFromOf(entry);
    const { id } = await rpcClient.utils.showContextMenu.call({
      items: [
        ...destinations.map((destination) => ({
          id: destination.id,
          label: destination.label,
        })),
        ...(more ? [{ id: "more", label: `More from ${more.label}` }] : []),
        ...(isRemovable(entry)
          ? [
              ...(destinations.length > 0 || more
                ? [{ separator: true as const }]
                : []),
              { id: "remove", label: "Remove from Activity" },
            ]
          : []),
      ],
    });
    if (id === "more" && more) {
      onMoreFrom(more.q);
    } else if (id === "remove") {
      onRemove(entry);
    } else {
      destinations.find((destination) => destination.id === id)?.run();
    }
  };

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-6 outline-none"
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
          if (item.kind === "day") {
            return (
              <div
                className={cn(
                  "absolute inset-x-0 top-0",
                  virtual.index > 0 && "pt-3",
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
          const text =
            item.kind === "turn"
              ? turnText(item.turn, modelName)
              : actionText(item.action, words);
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
                  context={text.context}
                  icon={<EntryIcon entry={item} />}
                  isPicked={picked === item.id}
                  onCheck={(on) => {
                    onCheck(item, on);
                  }}
                  onMenu={() => {
                    void showMenu(item);
                  }}
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
 * it, and its ⋮. A click shows its details beside the list and a double
 * click opens it.
 */
function ActivityRow({
  at,
  checked,
  context,
  icon,
  isPicked,
  onCheck,
  onMenu,
  onOpen,
  onPick,
  title,
}: {
  at: number;
  checked: boolean;
  context: string;
  icon: React.ReactNode;
  isPicked: boolean;
  onCheck: (on: boolean) => void;
  onMenu: () => void;
  /** Opens it where the page opens things, or in a tab of its own. */
  onOpen: (how: { newTab: boolean }) => void;
  onPick: () => void;
  title: string;
}) {
  return (
    <div
      aria-selected={isPicked}
      className={cn(
        "group/row flex h-10 cursor-default items-center gap-3 rounded-lg px-2.5 select-none",
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
        } else {
          onPick();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu();
      }}
      onDoubleClick={() => {
        onOpen({ newTab: false });
      }}
      role="option"
    >
      <span
        className="grid shrink-0"
        onClick={(event) => {
          event.stopPropagation();
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
      <span className="w-16 shrink-0 text-[13px] text-muted-foreground tabular-nums">
        {timeFormat.format(at)}
      </span>
      <span className="grid size-5 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 shrink truncate text-sm">{title}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
        {context}
      </span>
      <Button
        aria-label="More"
        className={cn(
          "shrink-0 text-foreground/60",
          isPicked
            ? ""
            : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onMenu();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
        }}
        size="icon-sm"
        variant="ghost"
      >
        <DotsThreeVerticalIcon className="size-4" weight="bold" />
      </Button>
    </div>
  );
}
