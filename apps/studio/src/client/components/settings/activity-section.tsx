import { displayLocale } from "@/client/lib/display-locale";
import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { APPS_HREF, CHATS_HREF } from "@/client/atoms/window";
import { zoomAtom } from "@/client/atoms/zoom";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { pathOf, SCREEN_ROUTES } from "@/client/components/window/window-href";
import { CopyButton } from "@/client/components/copy-button";
import { Button } from "@/client/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { keptAtom } from "@/client/lib/kept-state";
import { toast } from "sonner";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCInput, type RPCOutput } from "@/client/rpc/client";
import { modelDisplayName } from "@instrument-org/ai-gateway/client";
import { APP_NAME, AIProviderTypeSchema } from "@instrument-org/shared";
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { FunnelSimpleIcon } from "@phosphor-icons/react/FunnelSimple";
import { PulseIcon } from "@phosphor-icons/react/Pulse";
import { XIcon } from "@phosphor-icons/react/X";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  type Column,
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useEffect, useState } from "react";

type Filter = RPCInput["workspace"]["activity"]["list"]["filter"];
type Sort = RPCInput["workspace"]["activity"]["list"]["sort"];
type Row = RPCOutput["workspace"]["activity"]["list"][number];
type FacetField =
  | "connection"
  | "kind"
  | "model"
  | "origin"
  | "purpose"
  | "status";

const PAGE_SIZE = 100;
const ROW_HEIGHT = 36;
const MAX_COLUMN_WIDTH = 640;

const COLUMN_IDS = [
  "date",
  "kind",
  "purpose",
  "origin",
  "model",
  "status",
  "totalTokens",
  "durationMs",
] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

type ColumnSpec = {
  /** The row field the column reads. */
  field: keyof Row;
  label: string;
  /** The narrowest the column resizes to, in layout px. */
  min: number;
  right?: boolean;
  /** The column the server orders by, for the columns it can order by. */
  sort?: Sort["column"];
  /** The width the column starts at, in layout px. */
  size: number;
};

const COLUMNS: Record<ColumnId, ColumnSpec> = {
  date: {
    field: "startedAt",
    label: "Date",
    min: 96,
    // Fits the widest date and time a row shows ("Dec 28, 12:59 PM").
    size: 148,
    sort: "startedAt",
  },
  durationMs: {
    field: "durationMs",
    label: "Duration",
    min: 60,
    right: true,
    size: 84,
    sort: "durationMs",
  },
  kind: { field: "kind", label: "Type", min: 56, size: 76, sort: "kind" },
  model: {
    field: "modelServed",
    label: "Model",
    min: 96,
    size: 150,
    sort: "model",
  },
  origin: { field: "chatId", label: "From", min: 96, size: 220 },
  purpose: {
    field: "purpose",
    label: "For",
    min: 72,
    size: 116,
    sort: "purpose",
  },
  status: { field: "status", label: "Result", min: 60, size: 76 },
  totalTokens: {
    field: "totalTokens",
    label: "Tokens",
    min: 56,
    right: true,
    size: 76,
    sort: "totalTokens",
  },
};

function isColumnId(value: unknown): value is ColumnId {
  return COLUMN_IDS.some((id) => id === value);
}

type ColumnPrefs = {
  hidden: ColumnId[];
  widths: Record<string, number>;
};

/** The columns a person hid and the widths they dragged, kept per viewer. */
const columnPrefsAtom = keptAtom<ColumnPrefs>(
  "view",
  "activity.columns.v1",
  { hidden: [], widths: {} },
  (value, initial) => {
    if (typeof value !== "object" || value === null) {
      return initial;
    }
    const hidden =
      "hidden" in value && Array.isArray(value.hidden)
        ? value.hidden.filter(
            (id): id is ColumnId => isColumnId(id) && id !== "date",
          )
        : [];
    const widths: ColumnPrefs["widths"] = {};
    if (
      "widths" in value &&
      typeof value.widths === "object" &&
      value.widths !== null
    ) {
      for (const [id, width] of Object.entries(value.widths)) {
        if (
          isColumnId(id) &&
          typeof width === "number" &&
          Number.isFinite(width) &&
          width >= COLUMNS[id].min &&
          width <= MAX_COLUMN_WIDTH
        ) {
          widths[id] = width;
        }
      }
    }
    return { hidden, widths };
  },
);

const KIND_LABELS: Record<Row["kind"], string> = {
  decision: "Decision",
  image: "Image",
  language: "LLM",
  search: "Search",
};

const PURPOSE_LABELS: Record<Row["purpose"], string> = {
  "account-check": "Account check",
  "app-search": "App search",
  chat: "Chat",
  "chat-search": "Chat search",
  "chat-title": "Chat title",
  "emoji-suggestion": "Emoji suggestion",
  image: "Image",
  other: "Other",
  "settings-search": "Settings search",
  task: "Task",
  "title-check": "Title check",
  "topic-backfill": "Topic sorting",
  "topic-suggestion": "Topic suggestion",
  "web-search": "Web search",
  "x-search": "X search",
};

const SURFACE_LABELS: Record<NonNullable<Row["surface"]>, string> = {
  agent: "Agent",
  apps: "Apps",
  chats: "Chats",
  draft: "Draft",
  settings: "Settings",
  topics: "Topics",
};

const STATUS_LABELS: Record<Row["status"], string> = {
  failed: "Failed",
  finished: "Finished",
  limited: "Stopped at a limit",
  stopped: "Stopped",
};

const FIELD_LABELS: Record<FacetField, string> = {
  connection: "Provider",
  kind: "Type",
  model: "Model",
  origin: "From",
  purpose: "For",
  status: "Result",
};

const FIELDS: FacetField[] = [
  "kind",
  "purpose",
  "origin",
  "connection",
  "model",
  "status",
];

const PERIODS = {
  all: { days: undefined, label: "All time" },
  day: { days: 1, label: "Last 24 hours" },
  month: { days: 30, label: "Last 30 days" },
  week: { days: 7, label: "Last 7 days" },
} as const;
type Period = keyof typeof PERIODS;
const PERIOD_ORDER: Period[] = ["all", "day", "week", "month"];

const dateFormat = new Intl.DateTimeFormat(displayLocale, {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});
const fullDateFormat = new Intl.DateTimeFormat(displayLocale, {
  dateStyle: "medium",
  timeStyle: "medium",
});
const compactNumber = new Intl.NumberFormat(displayLocale, {
  maximumFractionDigits: 1,
  notation: "compact",
});
const wholeNumber = new Intl.NumberFormat(displayLocale);

function formatDuration(ms: null | number) {
  if (ms === null) {
    return "";
  }
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The model a row shows: the one that answered when the response said, otherwise the one asked for. */
function modelOf(row: Row) {
  return row.modelServed ?? row.modelRequested;
}

/** A model id without its maker's prefix, which the connection's mark already says. */
function shortModel(id: null | string) {
  return id?.split("/").at(-1) ?? "";
}

/**
 * A model's name as the model picker shows it, or one derived from its id for
 * one the catalog does not list (a decision model, the model an alias or a
 * router resolved to, or one no longer offered).
 */
function useModelName() {
  const { data } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const names = new Map<string, string>();
  for (const model of data?.models ?? []) {
    names.set(model.canonicalId, model.name);
    names.set(shortModel(model.canonicalId), model.name);
  }
  return (id: null | string) =>
    id === null
      ? ""
      : (names.get(id) ?? names.get(shortModel(id)) ?? modelDisplayName(id));
}

/** The screen a row's origin opens, when it is somewhere that still exists. */
function originHref(row: Row) {
  if (row.chatId) {
    return row.chatTitle
      ? pathOf(SCREEN_ROUTES.chat, { id: row.chatId })
      : undefined;
  }
  switch (row.surface) {
    case "apps": {
      return APPS_HREF;
    }
    case "chats":
    case "topics": {
      return CHATS_HREF;
    }
    default: {
      return undefined;
    }
  }
}

function originOf(row: Row) {
  if (row.chatId) {
    return row.chatTitle ?? "Deleted chat";
  }
  return row.surface ? SURFACE_LABELS[row.surface] : "";
}

function ConnectionMark({ type }: { type: null | string }) {
  const parsed = AIProviderTypeSchema.safeParse(type);
  return parsed.success ? (
    <AIProviderIcon className="size-3.5 shrink-0" colored type={parsed.data} />
  ) : (
    <span className="size-3.5 shrink-0" />
  );
}

/** Where a request came from, as a link to it when it is somewhere that still exists. */
function OriginLink({ row }: { row: Row }) {
  const gesturesFor = useGesturesFor();
  const closeSettings = useSetAtom(settingsModalAtom);
  const href = originHref(row);
  const gestures = href ? gesturesFor({ href, kind: "screen" }) : undefined;
  const label = originOf(row);
  if (!gestures) {
    return (
      <span
        className={cn("truncate", row.chatId && !row.chatTitle && "italic")}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      className="flex min-w-0 items-center gap-1 hover:text-foreground hover:underline"
      onAuxClick={(event) => {
        event.stopPropagation();
        gestures.onAuxClick(event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        gestures.onClick(event);
        closeSettings(null);
      }}
      title={`Open ${label}`}
      type="button"
    >
      <span className="truncate">{label}</span>
      <ArrowUpRightIcon className="size-3 shrink-0" />
    </button>
  );
}

function ModelLabel({ mark = true, row }: { mark?: boolean; row: Row }) {
  const modelName = useModelName();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {mark ? <ConnectionMark type={row.connectionType} /> : null}
      {modelOf(row) === null ? (
        <span className="truncate text-muted-foreground italic">Unknown</span>
      ) : (
        <span className="truncate">
          {modelName(modelOf(row))}
          {row.imageQuality && (
            <span className="text-muted-foreground">{` · ${qualityWord(row.imageQuality)}`}</span>
          )}
        </span>
      )}
    </span>
  );
}

/** An image's quality as the log says it: "Low", "Medium". */
function qualityWord(quality: string) {
  return quality.charAt(0).toUpperCase() + quality.slice(1);
}

function ProviderLabel({ row }: { row: Row }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ConnectionMark type={row.connectionType} />
      <span className="truncate">
        {row.connectionName ?? row.connectionType ?? "Unknown"}
      </span>
    </span>
  );
}

function ResultText({ row }: { row: Row }) {
  return (
    <span className={cn(row.status === "failed" && "text-destructive")}>
      {STATUS_LABELS[row.status]}
    </span>
  );
}

/** A token count in compact form, with the exact count on hover. */
function Tokens({
  count,
  empty = "",
}: {
  count: null | number;
  empty?: string;
}) {
  return count === null ? (
    empty
  ) : (
    <span title={wholeNumber.format(count)}>{compactNumber.format(count)}</span>
  );
}

/** What each column shows for a row, in the table and wherever else the same fact appears. */
const CELLS: Record<ColumnId, (row: Row) => ReactNode> = {
  date: (row) => (
    <span className="truncate text-muted-foreground tabular-nums">
      {dateFormat.format(row.startedAt)}
    </span>
  ),
  durationMs: (row) => (
    <span className="truncate text-muted-foreground tabular-nums">
      {formatDuration(row.durationMs)}
    </span>
  ),
  kind: (row) => <span className="truncate">{KIND_LABELS[row.kind]}</span>,
  model: (row) => <ModelLabel row={row} />,
  origin: (row) => (
    <span className="flex min-w-0 text-muted-foreground">
      <OriginLink row={row} />
    </span>
  ),
  purpose: (row) => (
    <span className="truncate">{PURPOSE_LABELS[row.purpose]}</span>
  ),
  status: (row) => (
    <span className="truncate text-muted-foreground">
      <ResultText row={row} />
    </span>
  ),
  totalTokens: (row) => (
    <span className="truncate text-muted-foreground tabular-nums">
      <Tokens count={row.totalTokens} />
    </span>
  ),
};

const columnDefs: ColumnDef<Row>[] = COLUMN_IDS.map((id) => {
  const spec = COLUMNS[id];
  return {
    accessorFn: (row) => row[spec.field],
    cell: ({ row }) => CELLS[id](row.original),
    enableHiding: id !== "date",
    enableSorting: spec.sort !== undefined,
    header: spec.label,
    id,
    maxSize: MAX_COLUMN_WIDTH,
    minSize: spec.min,
    size: spec.size,
    sortDescFirst: true,
  };
});

/**
 * Settings > Activity: every model request the app made, newest first, as a
 * log you can filter, sort, and open an entry from to see everything recorded
 * about it.
 */
export function ActivitySection() {
  const [openId, setOpenId] = useState<null | string>(null);
  useModalBack(() => {
    setOpenId(null);
  }, openId !== null);

  // Kept here rather than in the list, so stepping back from a request lands
  // on the same filters and order.
  const [filter, setFilter] = useState<Filter>({});
  const [period, setPeriod] = useState<Period>("all");
  const [sort, setSort] = useState<Sort>({
    column: "startedAt",
    direction: "desc",
  });

  if (openId !== null) {
    return (
      <RequestDetail
        id={openId}
        onBack={() => {
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <ActivityLog
      filter={filter}
      onOpen={setOpenId}
      period={period}
      setFilter={setFilter}
      setPeriod={setPeriod}
      setSort={setSort}
      sort={sort}
    />
  );
}

function ActivityLog({
  filter,
  onOpen,
  period,
  setFilter,
  setPeriod,
  setSort,
  sort,
}: {
  filter: Filter;
  onOpen: (id: string) => void;
  period: Period;
  setFilter: (filter: Filter) => void;
  setPeriod: (period: Period) => void;
  setSort: (sort: Sort) => void;
  sort: Sort;
}) {
  const { data: summary } = useQuery(
    rpcClient.workspace.activity.summary.queryOptions({ input: { filter } }),
  );
  const pages = useInfiniteQuery({
    getNextPageParam: (last: Row[], all: Row[][]) =>
      last.length < PAGE_SIZE ? undefined : all.length * PAGE_SIZE,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      rpcClient.workspace.activity.list.call(
        { filter, limit: PAGE_SIZE, offset: pageParam, sort },
        { signal },
      ),
    queryKey: ["activity", "list", filter, sort],
  });
  const rows = pages.data?.pages.flat() ?? [];
  const modelName = useModelName();
  const filtered =
    FIELDS.some((field) => (filter[field]?.length ?? 0) > 0) ||
    filter.since !== undefined;

  const choosePeriod = (next: Period) => {
    setPeriod(next);
    const { days } = PERIODS[next];
    setFilter({
      ...filter,
      since: days === undefined ? undefined : Date.now() - days * 86_400_000,
    });
  };

  const toggle = (field: FacetField, value: string) => {
    const current: string[] = filter[field] ?? [];
    const next = current.includes(value)
      ? current.filter((each) => each !== value)
      : [...current, value];
    setFilter({ ...filter, [field]: next.length > 0 ? next : undefined });
  };

  const labelFor = (field: FacetField, value: string): string => {
    switch (field) {
      case "connection": {
        return value;
      }
      case "kind": {
        return KIND_LABELS[value as Row["kind"]] ?? value; // a facet value is one of the stored kinds
      }
      case "model": {
        return modelName(value);
      }
      case "origin": {
        if (value.startsWith("surface:")) {
          const surface = value.slice("surface:".length);
          return (
            SURFACE_LABELS[surface as NonNullable<Row["surface"]>] ?? surface
          ); // a stored surface
        }
        return (
          summary?.facets.origin?.find((entry) => entry.value === value)
            ?.label ?? "Deleted chat"
        );
      }
      case "purpose": {
        return PURPOSE_LABELS[value as Row["purpose"]] ?? value; // a stored purpose
      }
      case "status": {
        return STATUS_LABELS[value as Row["status"]] ?? value; // a stored status
      }
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">Activity</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {`Everything ${APP_NAME} asked an AI model to do, with the model that answered and the tokens it used. It's kept in your Instrument folder, and what was said isn't.`}
          </p>
        </div>
        <Button
          disabled={!summary || summary.requests === 0}
          onClick={() => {
            void rpcClient.activity.saveCsv
              .call({ filter })
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
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {FIELDS.map((field) => {
          const values = filter[field] ?? [];
          return values.length === 0 ? null : (
            <FilterChip
              key={field}
              label={FIELD_LABELS[field]}
              onClear={() => {
                setFilter({ ...filter, [field]: undefined });
              }}
              value={values.map((value) => labelFor(field, value)).join(", ")}
            />
          );
        })}
        {period === "all" ? null : (
          <FilterChip
            label="Date"
            onClear={() => {
              choosePeriod("all");
            }}
            value={PERIODS[period].label}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="border-dashed" size="sm" variant="outline">
              <FunnelSimpleIcon />
              Filter
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Date</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  onValueChange={(value) => {
                    choosePeriod(value as Period); // the radio values are the PERIODS keys
                  }}
                  value={period}
                >
                  {PERIOD_ORDER.map((key) => (
                    <DropdownMenuRadioItem key={key} value={key}>
                      {PERIODS[key].label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {FIELDS.map((field) => {
              const values = summary?.facets[field] ?? [];
              return (
                <DropdownMenuSub key={field}>
                  <DropdownMenuSubTrigger disabled={values.length === 0}>
                    {FIELD_LABELS[field]}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto">
                    {values.map(({ connectionType, count, value }) => (
                      <DropdownMenuCheckboxItem
                        checked={(filter[field] ?? []).includes(value)}
                        key={value}
                        onCheckedChange={() => {
                          toggle(field, value);
                        }}
                        onSelect={(event) => {
                          event.preventDefault();
                        }}
                      >
                        {field === "connection" || field === "model" ? (
                          <ConnectionMark type={connectionType ?? null} />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">
                          {labelFor(field, value)}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {wholeNumber.format(count)}
                        </span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        {summary ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            {`${wholeNumber.format(summary.requests)} ${summary.requests === 1 ? "entry" : "entries"} · ${compactNumber.format(summary.tokens)} tokens`}
          </span>
        ) : null}
      </div>

      {summary && summary.requests === 0 ? (
        <EmptyLog filtered={filtered} />
      ) : (
        <LogTable
          hasMore={pages.hasNextPage}
          loadMore={() => {
            if (!pages.isFetchingNextPage) {
              void pages.fetchNextPage();
            }
          }}
          onOpen={onOpen}
          rows={rows}
          setSort={setSort}
          sort={sort}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  onClear,
  value,
}: {
  label: string;
  onClear: () => void;
  value: string;
}) {
  return (
    <span className="flex h-8 max-w-80 items-center gap-1 rounded-lg bg-muted pr-1 pl-2.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{`${label} is`}</span>
      <span className="truncate font-medium">{value}</span>
      <Button
        aria-label={`Remove the ${label.toLowerCase()} filter`}
        className="size-6"
        onClick={onClear}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon className="size-3" />
      </Button>
    </span>
  );
}

function EmptyLog({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl bg-card p-8 text-center shadow-sm">
      <span className="mb-4 grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
        <PulseIcon className="size-5.5" />
      </span>
      {filtered ? (
        <p className="text-sm font-medium">No entries match these filters</p>
      ) : (
        <>
          <p className="text-sm font-medium">No activity yet</p>
          <p className="mt-1 max-w-96 text-sm text-muted-foreground">
            {`${APP_NAME} hasn't asked an AI model for anything yet. When you start a chat, you'll see its activity here.`}
          </p>
        </>
      )}
    </div>
  );
}

/** Which edges of a scroller have more content past them. */
function useScrollEdges(scroller: HTMLDivElement | null) {
  const [edges, setEdges] = useState({
    bottom: false,
    end: false,
    start: false,
    top: false,
  });
  useEffect(() => {
    if (!scroller) {
      return;
    }
    const measure = () => {
      const next = {
        bottom:
          scroller.scrollTop + scroller.clientHeight <
          scroller.scrollHeight - 1,
        end:
          scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1,
        start: scroller.scrollLeft > 1,
        top: scroller.scrollTop > 1,
      };
      setEdges((previous) =>
        previous.bottom === next.bottom &&
        previous.end === next.end &&
        previous.start === next.start &&
        previous.top === next.top
          ? previous
          : next,
      );
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    // The scroller's own box changes with the window, and its content's with
    // the rows loaded and the column widths.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.firstElementChild) {
      observer.observe(scroller.firstElementChild);
    }
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [scroller]);
  return edges;
}

function LogTable({
  hasMore,
  loadMore,
  onOpen,
  rows,
  setSort,
  sort,
}: {
  hasMore: boolean;
  loadMore: () => void;
  onOpen: (id: string) => void;
  rows: Row[];
  setSort: (sort: Sort) => void;
  sort: Sort;
}) {
  // `useReactTable` holds a mutable instance across renders, which the compiler
  // cannot memoize safely. See TanStack/table#6137.
  "use no memo";

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const edges = useScrollEdges(scroller);
  const [prefs, setPrefs] = useAtom(columnPrefsAtom);
  // The column a right click landed on, for the menu's sort and hide items.
  const [menuColumn, setMenuColumn] = useState<ColumnId | null>(null);

  // oxlint-disable-next-line react/incompatible-library
  const table = useReactTable({
    columnResizeMode: "onChange",
    columns: columnDefs,
    data: rows,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualSorting: true,
    onColumnSizingChange: (updater) => {
      setPrefs((previous) => ({
        ...previous,
        widths:
          typeof updater === "function" ? updater(previous.widths) : updater,
      }));
    },
    onColumnVisibilityChange: (updater) => {
      setPrefs((previous) => {
        const current = Object.fromEntries(
          previous.hidden.map((id) => [id, false]),
        );
        const next = typeof updater === "function" ? updater(current) : updater;
        return {
          ...previous,
          hidden: COLUMN_IDS.filter(
            (id) => id !== "date" && next[id] === false,
          ),
        };
      });
    },
    onSortingChange: (updater) => {
      const current = [{ desc: sort.direction === "desc", id: sortIdOf(sort) }];
      const next = (
        typeof updater === "function" ? updater(current) : updater
      )[0];
      const column =
        next && isColumnId(next.id) ? COLUMNS[next.id].sort : undefined;
      if (next && column) {
        setSort({ column, direction: next.desc ? "desc" : "asc" });
      }
    },
    state: {
      columnSizing: prefs.widths,
      columnVisibility: Object.fromEntries(
        prefs.hidden.map((id) => [id, false]),
      ),
      sorting: [{ desc: sort.direction === "desc", id: sortIdOf(sort) }],
    },
  });

  const tableRows = table.getRowModel().rows;
  const columns = table.getVisibleLeafColumns();
  const totalWidth = table.getTotalSize();

  // Every row is one line at a fixed height, so only the scrollport is
  // measured, in layout px: inside the window's CSS `zoom` the default reads
  // the on-screen rect.
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    estimateSize: () => ROW_HEIGHT,
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
  const items = virtualizer.getVirtualItems();
  const last = items.at(-1);
  useEffect(() => {
    if (hasMore && last && last.index >= rows.length - 20) {
      loadMore();
    }
  }, [hasMore, last, loadMore, rows.length]);

  const menuTarget = menuColumn ? table.getColumn(menuColumn) : undefined;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-card shadow-sm [--scroll-edge-inset-top:--spacing(9)] [--scroll-edge-surface:var(--card)]"
      data-scroll-bottom={edges.bottom || undefined}
      data-scroll-end={edges.end || undefined}
      data-scroll-start={edges.start || undefined}
      data-scroll-top={edges.top || undefined}
    >
      <div className="min-h-0 flex-1 overflow-auto" ref={setScroller}>
        <div className="relative" style={{ minWidth: totalWidth }}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className="sticky top-0 z-10 flex h-9 items-center border-b bg-card text-xs font-medium text-muted-foreground"
                onContextMenuCapture={() => {
                  setMenuColumn(null);
                }}
                role="row"
                style={{ minWidth: totalWidth }}
              >
                {table.getFlatHeaders().map((header) => {
                  const id = header.column.id;
                  if (!isColumnId(id) || !header.column.getIsVisible()) {
                    return null;
                  }
                  return (
                    <HeaderCell
                      column={header.column}
                      id={id}
                      key={id}
                      onContextMenu={() => {
                        setMenuColumn(id);
                      }}
                      onResize={(width) => {
                        table.setColumnSizing((previous) => ({
                          ...previous,
                          [id]: width,
                        }));
                      }}
                    />
                  );
                })}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {menuTarget?.getCanSort() ? (
                <>
                  <ContextMenuItem
                    onSelect={() => {
                      menuTarget.toggleSorting(false);
                    }}
                  >
                    Sort ascending
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => {
                      menuTarget.toggleSorting(true);
                    }}
                  >
                    Sort descending
                  </ContextMenuItem>
                </>
              ) : null}
              {menuTarget?.getCanHide() ? (
                <ContextMenuItem
                  onSelect={() => {
                    menuTarget.toggleVisibility(false);
                  }}
                >
                  Hide column
                </ContextMenuItem>
              ) : null}
              {menuTarget ? <ContextMenuSeparator /> : null}
              {table.getAllLeafColumns().map((column) => (
                <ContextMenuCheckboxItem
                  checked={column.getIsVisible()}
                  disabled={!column.getCanHide()}
                  key={column.id}
                  onCheckedChange={(checked) => {
                    column.toggleVisibility(checked);
                  }}
                  onSelect={(event) => {
                    // Kept open, so several columns can be shown or hidden in one go.
                    event.preventDefault();
                  }}
                >
                  {isColumnId(column.id) ? COLUMNS[column.id].label : column.id}
                </ContextMenuCheckboxItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => {
                  table.resetColumnSizing();
                }}
              >
                Reset column widths
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {items.map((item) => {
              const record = tableRows[item.index];
              if (!record) {
                return null;
              }
              return (
                <div
                  className="absolute inset-x-0 flex items-center border-b text-left text-sm hover:bg-muted/60"
                  key={record.id}
                  onClick={() => {
                    onOpen(record.id);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      onOpen(record.id);
                    }
                  }}
                  role="button"
                  style={{
                    height: ROW_HEIGHT,
                    minWidth: totalWidth,
                    top: item.start,
                  }}
                  tabIndex={0}
                >
                  {columns.map((column) => {
                    const id = column.id;
                    return isColumnId(id) ? (
                      <div
                        className={cn(
                          "flex min-w-0 shrink-0 items-center px-2",
                          COLUMNS[id].right && "justify-end",
                        )}
                        key={id}
                        style={{ width: column.getSize() }}
                      >
                        {CELLS[id](record.original)}
                      </div>
                    ) : null;
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <span aria-hidden className="scroll-edge-fade" data-edge="start" />
      <span aria-hidden className="scroll-edge-fade" data-edge="end" />
      <span aria-hidden className="scroll-edge-fade" data-edge="top" />
      <span aria-hidden className="scroll-edge-fade" data-edge="bottom" />
    </div>
  );
}

/** The id of the table column that orders by a server sort column. */
function sortIdOf(sort: Sort): ColumnId {
  return COLUMN_IDS.find((id) => COLUMNS[id].sort === sort.column) ?? "date";
}

function HeaderCell({
  column,
  id,
  onContextMenu,
  onResize,
}: {
  column: Column<Row>;
  id: ColumnId;
  onContextMenu: () => void;
  onResize: (width: number) => void;
}) {
  "use no memo";

  const zoom = useAtomValue(zoomAtom);
  const sorted = column.getIsSorted();
  const label = COLUMNS[id].label;
  return (
    <div
      className="relative flex h-full shrink-0 items-center px-2"
      onContextMenu={onContextMenu}
      role="columnheader"
      style={{ width: column.getSize() }}
    >
      {column.getCanSort() ? (
        <button
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground",
            COLUMNS[id].right && "justify-end",
            sorted && "text-foreground",
          )}
          onClick={() => {
            column.toggleSorting();
          }}
          type="button"
        >
          <span className="truncate">{label}</span>
          {sorted === "desc" ? (
            <ArrowDownIcon className="size-3 shrink-0" />
          ) : null}
          {sorted === "asc" ? (
            <ArrowUpIcon className="size-3 shrink-0" />
          ) : null}
        </button>
      ) : (
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            COLUMNS[id].right && "text-right",
          )}
        >
          {label}
        </span>
      )}
      {/* The pointer moves in on-screen px and the column is sized in layout
          px, so the drag is divided by the zoom. */}
      <span
        aria-hidden
        className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize after:absolute after:inset-y-2 after:right-0 after:w-px after:bg-border hover:after:bg-foreground/40"
        onClick={(event) => {
          event.stopPropagation();
        }}
        onDoubleClick={() => {
          column.resetSize();
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const handle = event.currentTarget;
          const startX = event.clientX;
          const startWidth = column.getSize();
          handle.setPointerCapture(event.pointerId);
          const move = (moved: PointerEvent) => {
            const width = Math.min(
              column.columnDef.maxSize ?? MAX_COLUMN_WIDTH,
              Math.max(
                column.columnDef.minSize ?? 0,
                Math.round(startWidth + (moved.clientX - startX) / zoom),
              ),
            );
            onResize(width);
          };
          const end = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", end);
            handle.removeEventListener("pointercancel", end);
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", end);
          handle.addEventListener("pointercancel", end);
        }}
      />
    </div>
  );
}

/** Everything recorded about one entry, with a way back to the log. */
function RequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: row } = useQuery(
    rpcClient.workspace.activity.byId.queryOptions({ input: { id } }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <ArrowLeftIcon className="size-4" />
          Activity
        </button>
        <span className="flex-1" />
        {row ? (
          <CopyButton
            className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            label="Copy details"
            onCopy={() =>
              navigator.clipboard.writeText(JSON.stringify(row, null, 2))
            }
            tooltip="Copy details"
          />
        ) : null}
      </div>
      {row ? (
        <>
          <div className="flex items-center gap-3">
            <ConnectionMark type={row.connectionType} />
            <div className="min-w-0">
              <div className="truncate font-medium">
                {`${PURPOSE_LABELS[row.purpose]} · ${KIND_LABELS[row.kind]}`}
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {originOf(row) || "No chat"}
              </div>
            </div>
          </div>
          <div className="divide-y rounded-xl bg-card px-4 shadow-sm">
            <DetailGroup title="Request">
              <Detail label="Started">
                {fullDateFormat.format(row.startedAt)}
              </Detail>
              <Detail label="Duration">
                {formatDuration(row.durationMs) || "Not recorded"}
              </Detail>
              <Detail label="Result">
                <ResultText row={row} />
                {row.finishReason ? `, ${row.finishReason}` : ""}
              </Detail>
              {row.error ? <ErrorDetail error={row.error} /> : null}
              <Detail label="From">
                {originOf(row) ? (
                  <span className="flex">
                    <OriginLink row={row} />
                  </span>
                ) : (
                  "None"
                )}
              </Detail>
              <Detail code label="Request ID">
                {row.id}
              </Detail>
              {row.responseId ? (
                <Detail code label="Response ID">
                  {row.responseId}
                </Detail>
              ) : null}
            </DetailGroup>
            <DetailGroup title="Model">
              <Detail label="Provider">
                <ProviderLabel row={row} />
              </Detail>
              <Detail label="Model">
                <ModelLabel mark={false} row={row} />
              </Detail>
              <Detail code={row.modelRequested !== null} label="Asked for">
                {row.modelRequested ?? "Not recorded"}
              </Detail>
              <Detail code={row.modelServed !== null} label="Answered by">
                {row.modelServed ?? "Not reported separately"}
              </Detail>
              {row.imageQuality ? (
                <Detail label="Image quality">
                  {qualityWord(row.imageQuality)}
                </Detail>
              ) : null}
            </DetailGroup>
            <DetailGroup title="Tokens">
              <Detail label="Input">
                <Tokens count={row.inputTokens} empty="Not reported" />
              </Detail>
              {row.cacheReadTokens ? (
                <Detail label="From cache">
                  <Tokens count={row.cacheReadTokens} />
                </Detail>
              ) : null}
              {row.cacheWriteTokens ? (
                <Detail label="Cache write">
                  <Tokens count={row.cacheWriteTokens} />
                </Detail>
              ) : null}
              <Detail label="Output">
                <Tokens count={row.outputTokens} empty="Not reported" />
              </Detail>
              {row.reasoningTokens ? (
                <Detail label="Reasoning">
                  <Tokens count={row.reasoningTokens} />
                </Detail>
              ) : null}
            </DetailGroup>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * An error as a person reads it: the message a provider put in a JSON body
 * when there is one, with the whole text kept below it.
 */
function readableError(error: string) {
  const start = error.indexOf("{");
  if (start === -1) {
    return { message: error, raw: undefined };
  }
  try {
    const body: unknown = JSON.parse(error.slice(start));
    const nested =
      typeof body === "object" && body !== null && "error" in body
        ? body.error
        : body;
    const message =
      typeof nested === "object" && nested !== null && "message" in nested
        ? nested.message
        : undefined;
    return typeof message === "string"
      ? { message, raw: error }
      : { message: error, raw: undefined };
  } catch {
    return { message: error, raw: undefined };
  }
}

function ErrorDetail({ error }: { error: string }) {
  const { message, raw } = readableError(error);
  return (
    <Detail label="Error">
      <span className="block">{message}</span>
      {raw ? (
        <code className="mt-1 block font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
          {raw}
        </code>
      ) : null}
    </Detail>
  );
}

function DetailGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="py-3">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function Detail({
  children,
  code = false,
  label,
}: {
  children: ReactNode;
  code?: boolean;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 break-words",
          code && "font-mono text-xs leading-5",
        )}
      >
        {children}
      </span>
    </div>
  );
}
