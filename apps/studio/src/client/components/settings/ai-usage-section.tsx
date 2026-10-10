import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { CHATS_HREF } from "@/client/atoms/window";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { Button } from "@/client/components/ui/button";
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
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCInput, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME, AIProviderTypeSchema } from "@instrument-org/shared";
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { FunnelSimpleIcon } from "@phosphor-icons/react/FunnelSimple";
import { PulseIcon } from "@phosphor-icons/react/Pulse";
import { XIcon } from "@phosphor-icons/react/X";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSetAtom } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

type Filter = RPCInput["workspace"]["aiUsage"]["list"]["filter"];
type Sort = RPCInput["workspace"]["aiUsage"]["list"]["sort"];
type Row = RPCOutput["workspace"]["aiUsage"]["list"][number];
type FacetField =
  | "connection"
  | "kind"
  | "model"
  | "origin"
  | "purpose"
  | "status";

const PAGE_SIZE = 100;
const ROW_HEIGHT = 36;
const COLUMNS = "grid-cols-[112px_118px_116px_minmax(0,1fr)_132px_52px_60px]";

const KIND_LABELS: Record<Row["kind"], string> = {
  decision: "Decision model",
  image: "Image model",
  language: "Language model",
  search: "Web search",
};

const PURPOSE_LABELS: Record<Row["purpose"], string> = {
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
  stopped: "Stopped",
};

const FIELD_LABELS: Record<FacetField, string> = {
  connection: "Connection",
  kind: "Type",
  model: "Model",
  origin: "Origin",
  purpose: "Purpose",
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

const SORTABLE: { column: Sort["column"]; label: string; right?: true }[] = [
  { column: "startedAt", label: "Date" },
  { column: "kind", label: "Type" },
  { column: "purpose", label: "Purpose" },
];

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});
const fullDateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});
const compactNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
});
const wholeNumber = new Intl.NumberFormat();

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

/**
 * Every model request the app made, newest first: a log you can filter,
 * sort, and open a request from to see everything recorded about it.
 */
export function AIUsageSection() {
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
    <UsageLog
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

function UsageLog({
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
    rpcClient.workspace.aiUsage.summary.queryOptions({ input: { filter } }),
  );
  const pages = useInfiniteQuery({
    getNextPageParam: (last: Row[], all: Row[][]) =>
      last.length < PAGE_SIZE ? undefined : all.length * PAGE_SIZE,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      rpcClient.workspace.aiUsage.list.call(
        { filter, limit: PAGE_SIZE, offset: pageParam, sort },
        { signal },
      ),
    queryKey: ["ai-usage", "list", filter, sort],
  });
  const rows = pages.data?.pages.flat() ?? [];
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
        return shortModel(value);
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
      <div
        className="flex shrink-0 items-start gap-4"
        {...settingAnchor("ai-usage")}
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">AI usage</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {`Every request ${APP_NAME} sends to an AI shows up here, with the model that answered and the tokens it used. We keep these details on your computer, but we don't keep what was said.`}
          </p>
        </div>
        <Button
          disabled={!summary || summary.requests === 0}
          onClick={() => {
            void rpcClient.aiUsage.saveCsv
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
                    {values.map(({ count, value }) => (
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
                        {field === "connection" ? (
                          <ConnectionMark type={value} />
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
            {`${wholeNumber.format(summary.requests)} ${summary.requests === 1 ? "request" : "requests"} · ${compactNumber.format(summary.tokens)} tokens`}
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
        <p className="text-sm font-medium">No requests match these filters</p>
      ) : (
        <>
          <p className="text-sm font-medium">No AI requests yet</p>
          <p className="mt-1 max-w-96 text-sm text-muted-foreground">
            {`${APP_NAME} hasn't sent anything to an AI since you set it up. When you start a chat, its requests will show up here.`}
          </p>
        </>
      )}
    </div>
  );
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
  const scrollRef = useRef<HTMLDivElement>(null);
  // Every row is one line at a fixed height, so nothing is measured and the
  // window's zoom has nothing to throw off.
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const last = items.at(-1);
  useEffect(() => {
    if (hasMore && last && last.index >= rows.length - 20) {
      loadMore();
    }
  }, [hasMore, last, loadMore, rows.length]);

  const header = (column: Sort["column"], label: string, right = false) => {
    const active = sort.column === column;
    return (
      <button
        className={cn(
          "flex items-center gap-1 text-left hover:text-foreground",
          right && "justify-end",
          active && "text-foreground",
        )}
        onClick={() => {
          setSort({
            column,
            direction: active && sort.direction === "desc" ? "asc" : "desc",
          });
        }}
        type="button"
      >
        {label}
        {active ? (
          sort.direction === "desc" ? (
            <ArrowDownIcon className="size-3" />
          ) : (
            <ArrowUpIcon className="size-3" />
          )
        ) : null}
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-card shadow-sm">
      <div
        className={cn(
          "grid shrink-0 items-center gap-2.5 border-b px-3 py-2 text-xs font-medium text-muted-foreground",
          COLUMNS,
        )}
      >
        {SORTABLE.map(({ column, label }) => (
          <span key={column}>{header(column, label)}</span>
        ))}
        <span>Origin</span>
        {header("model", "Model")}
        {header("totalTokens", "Tokens", true)}
        {header("durationMs", "Duration", true)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((item) => {
            const row = rows[item.index];
            if (!row) {
              return null;
            }
            return (
              <button
                className={cn(
                  "absolute inset-x-0 grid items-center gap-2.5 border-b px-3 text-left text-sm hover:bg-muted/60",
                  COLUMNS,
                )}
                key={row.id}
                onClick={() => {
                  onOpen(row.id);
                }}
                style={{ height: ROW_HEIGHT, top: item.start }}
                type="button"
              >
                <span className="truncate text-muted-foreground tabular-nums">
                  {dateFormat.format(row.startedAt)}
                </span>
                <span className="truncate">{KIND_LABELS[row.kind]}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">
                    {PURPOSE_LABELS[row.purpose]}
                  </span>
                  {row.status === "finished" ? null : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {STATUS_LABELS[row.status]}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "truncate text-muted-foreground",
                    row.chatId && !row.chatTitle && "italic",
                  )}
                >
                  {originOf(row)}
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <ConnectionMark type={row.connectionType} />
                  <span className="truncate">{shortModel(modelOf(row))}</span>
                </span>
                <span className="text-right text-muted-foreground tabular-nums">
                  {row.totalTokens === null
                    ? ""
                    : compactNumber.format(row.totalTokens)}
                </span>
                <span className="text-right text-muted-foreground tabular-nums">
                  {formatDuration(row.durationMs)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Everything recorded about one request, with a way back to the log. */
function RequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: row } = useQuery(
    rpcClient.workspace.aiUsage.byId.queryOptions({ input: { id } }),
  );
  const closeSettings = useSetAtom(settingsModalAtom);
  const gestures = useOpenGestures({
    href: `${CHATS_HREF}/${row?.chatId ?? ""}`,
    kind: "screen",
  });
  const open = gestures.destinations.find((entry) => entry.id === "open");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <ArrowLeftIcon className="size-4" />
          AI usage
        </button>
        <span className="flex-1" />
        {row?.chatId && row.chatTitle && open ? (
          <Button
            onClick={() => {
              open.run();
              closeSettings(null);
            }}
            size="sm"
            variant="outline"
          >
            <ArrowSquareOutIcon />
            Open chat
          </Button>
        ) : null}
        {row ? (
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify(row, null, 2));
              toast.success("Copied the request's details");
            }}
            size="sm"
            variant="outline"
          >
            <CopyIcon />
            Copy details
          </Button>
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
                {STATUS_LABELS[row.status]}
                {row.finishReason ? `, ${row.finishReason}` : ""}
              </Detail>
              {row.error ? <Detail label="Error">{row.error}</Detail> : null}
              <Detail label="Origin">
                {row.chatId && !row.chatTitle
                  ? "A chat you've since deleted"
                  : originOf(row) || "None"}
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
              <Detail label="Connection">
                {row.connectionName ?? row.connectionType ?? "Unknown"}
              </Detail>
              <Detail code={row.modelRequested !== null} label="Asked for">
                {row.modelRequested ?? "Not recorded"}
              </Detail>
              <Detail code={row.modelServed !== null} label="Answered by">
                {row.modelServed ?? "Not reported separately"}
              </Detail>
            </DetailGroup>
            <DetailGroup title="Tokens">
              <Detail label="Input">{tokens(row.inputTokens)}</Detail>
              {row.cacheReadTokens ? (
                <Detail label="From cache">
                  {tokens(row.cacheReadTokens)}
                </Detail>
              ) : null}
              {row.cacheWriteTokens ? (
                <Detail label="Cache write">
                  {tokens(row.cacheWriteTokens)}
                </Detail>
              ) : null}
              <Detail label="Output">{tokens(row.outputTokens)}</Detail>
              {row.reasoningTokens ? (
                <Detail label="Reasoning">{tokens(row.reasoningTokens)}</Detail>
              ) : null}
            </DetailGroup>
          </div>
        </>
      ) : null}
    </div>
  );
}

function tokens(count: null | number) {
  return count === null ? "Not reported" : wholeNumber.format(count);
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
