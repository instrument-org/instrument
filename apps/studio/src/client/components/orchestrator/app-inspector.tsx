import { MarkdownCodeBlock } from "@/client/components/code-block";
import { CopyButton } from "@/client/components/copy-button";
import { Markdown } from "@/client/components/markdown";
import { thisComputer } from "@/client/components/orchestrator/computer-name";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { Skeleton } from "@/client/components/ui/skeleton";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { PlugsIcon } from "@phosphor-icons/react/Plugs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  childrenOf,
  detailRead,
  isBare,
  isLink,
  isListAnswer,
  isObject,
  type Json,
  labelOf,
  languageOf,
  listsFirst,
  looksLikeCode,
  parse,
  parseSequence,
  recordsOf,
  splitCode,
  summaryOf,
  titleOf,
  type Tool,
} from "./app-inspector-model";

/** The inspector's card, shared with its skeleton so nothing moves when it fills. */
const FRAME_CLASS_NAME =
  "grid min-h-[22rem] flex-1 grid-rows-[minmax(0,1fr)] grid-cols-[minmax(8rem,12rem)_minmax(12rem,1fr)_minmax(16rem,1.6fr)] overflow-hidden rounded-xl border border-border bg-background text-[13px] shadow-sm";

/** Widths for skeleton rows, varied so a column reads as a list. */
const ROW_WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-2/5", "w-3/5"];

/** How long an answer is reused before the server is asked again. */
const STALE_MS = 60_000;

/** What the person has open in the inspector, as the read that fetches it again. */
export interface InspectorReading {
  args: Json;
  title: string;
  tool: string;
}

/**
 * A generic browser of a connected app's own data: the reads that answer
 * with nothing asked of them at the left, and what the chosen one returned
 * beside them, as rows and a record when it is a list and whole when it is
 * not. Every press is a read the server itself marks as one; nothing here is
 * drawn per app.
 */
export function AppInspector({
  name,
  onReading,
  runsHere,
  slug,
}: {
  name: string;
  /** Told what record is open, for the note the agent reads with the next message. */
  onReading: (reading: InspectorReading | undefined) => void;
  /** Whether the app's server is on this computer, which is what an unreachable one most often means. */
  runsHere: boolean;
  slug: string;
}) {
  const tools = useQuery({
    ...rpcClient.apps.inspect.queryOptions({ input: { slug } }),
    staleTime: STALE_MS,
  });
  const [kind, setKind] = useState<string>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<number>();

  // Nothing until the app has said what it can do: an app with nothing to
  // browse never shows the section at all, not even for a moment.
  if (tools.isPending) {
    return null;
  }
  if (tools.isError) {
    return (
      <Section name={name}>
        <div className="flex min-h-[16rem] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 text-center">
          <PlugsIcon className="size-6 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Couldn’t reach {name}</p>
            <p className="mt-1 max-w-sm text-[13px] leading-5 text-muted-foreground">
              {runsHere
                ? `Open ${name} on ${thisComputer()}, then try again.`
                : `${name} didn’t answer. Try again in a moment.`}
            </p>
          </div>
          <button
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium shadow-xs hover:bg-accent disabled:opacity-60"
            disabled={tools.isFetching}
            onClick={() => void tools.refetch()}
            type="button"
          >
            <ArrowClockwiseIcon
              className={cn("size-3.5", tools.isFetching && "animate-spin")}
            />
            Try again
          </button>
        </div>
      </Section>
    );
  }
  const reads = tools.data.filter((tool) => tool.isRead);
  // Everything the app offers, in three groups: what a press reads, what
  // reads only with something asked of it, and what changes things. Only
  // the first group ever runs here; the others are described.
  const groups = [
    { label: "Views", tools: reads.filter(isBare).toSorted(listsFirst) },
    { label: "Lookups", tools: reads.filter((tool) => !isBare(tool)) },
    {
      label: "Actions",
      tools: tools.data.filter((tool) => !tool.isRead),
    },
  ].filter((group) => group.tools.length > 0);
  const first = groups[0];
  const runnable = first?.label === "Views" ? first.tools : [];
  const current =
    tools.data.find((tool) => tool.name === kind) ??
    runnable[0] ??
    tools.data[0];
  if (!current) {
    return null;
  }

  return (
    <Section name={name}>
      <div className={FRAME_CLASS_NAME}>
        <div className="min-w-0 overflow-y-auto border-r border-border bg-muted/40 p-1.5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
                {group.label}
              </p>
              {group.tools.map((tool) => (
                <button
                  className={cn(
                    "block w-full truncate rounded-md px-2 py-1.5 text-left hover:bg-accent",
                    tool.name === current.name && "bg-accent font-medium",
                  )}
                  key={tool.name}
                  onClick={() => {
                    setKind(tool.name);
                    setFilters({});
                    setPicked(undefined);
                  }}
                  title={tool.description}
                  type="button"
                >
                  {labelOf(tool)}
                </button>
              ))}
            </div>
          ))}
        </div>
        {runnable.includes(current) ? (
          <Records
            filters={filters}
            onFilter={(param, value) => {
              setFilters((all) => ({ ...all, [param]: value }));
              setPicked(undefined);
            }}
            onPick={setPicked}
            onReading={onReading}
            picked={picked}
            reads={reads}
            slug={slug}
            tool={current}
          />
        ) : (
          <ToolSheet appName={name} tool={current} />
        )}
      </div>
    </Section>
  );
}

/**
 * Code as the transcript draws it, highlighted, with any prose a server put
 * after it (instructions for the agent, most often) kept as words.
 */
function CodeAndProse({ text }: { text: string }) {
  const { code, prose } = splitCode(text);
  return (
    <>
      <MarkdownCodeBlock code={code} language={languageOf(code)} />
      {prose ? (
        <div className="text-muted-foreground">
          <Markdown markdown={prose} />
        </div>
      ) : null}
    </>
  );
}

/**
 * A record's fields, and when some read takes exactly what the record
 * carries, that read's fuller answer in its place.
 */
function Detail({
  isSourceFetching,
  onBack,
  onReading,
  onRefreshSource,
  reads,
  record,
  slug,
  source,
  sourceArgs,
}: {
  /** Whether the list this record came from is being read again. */
  isSourceFetching: boolean;
  onBack?: () => void;
  onReading: (reading: InspectorReading | undefined) => void;
  /** Reads the list again, for a record no read of its own fetches. */
  onRefreshSource: () => void;
  reads: Tool[];
  record: Json;
  slug: string;
  source: Tool;
  sourceArgs: Json;
}) {
  const guess = detailRead(reads, source, record);
  const detail = useQuery({
    ...rpcClient.apps.read.queryOptions({
      input: {
        args: guess?.args ?? {},
        slug,
        tool: guess?.tool.name ?? "",
      },
    }),
    enabled: guess !== undefined,
    staleTime: STALE_MS,
  });
  // A guessed read that fails was the wrong guess, not something to show:
  // the row's own fields stand in.
  const drill =
    guess && !detail.isError && !detail.data?.isError ? guess : undefined;
  // A record listed inside this one, opened in its place.
  const [opened, setOpened] = useState<Json>();
  const title = titleOf(record);
  useReportReading(
    onReading,
    opened
      ? null
      : drill
        ? { args: drill.args, title, tool: drill.tool.name }
        : { args: sourceArgs, title, tool: source.name },
  );

  const fuller = detail.data ? parse(detail.data.text) : undefined;
  const shown = isObject(fuller) ? fuller : undefined;
  const drilledRecords =
    fuller !== undefined && shown === undefined ? recordsOf(fuller) : [];

  if (opened && drill) {
    return (
      <Detail
        isSourceFetching={detail.isFetching}
        onBack={() => {
          setOpened(undefined);
        }}
        onReading={onReading}
        onRefreshSource={() => void detail.refetch()}
        reads={reads}
        record={opened}
        slug={slug}
        source={drill.tool}
        sourceArgs={drill.args}
      />
    );
  }
  return (
    <>
      <PaneHeader
        copyText={detail.data?.text ?? JSON.stringify(record, null, 2)}
        isFetching={drill ? detail.isFetching : isSourceFetching}
        meta={
          drill && detail.isError
            ? detail.error.message
            : labelOf(drill?.tool ?? source)
        }
        onBack={onBack}
        onRefresh={() => {
          if (drill) {
            void detail.refetch();
          } else {
            onRefreshSource();
          }
        }}
        title={title}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {drill && detail.isPending ? (
          <SkeletonFields />
        ) : detail.data && fuller === undefined ? (
          <Markdown markdown={detail.data.text} />
        ) : (
          <Fields record={shown ?? record} />
        )}
        {drilledRecords.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {drilledRecords.length} in it
            </p>
            <ul className="-mx-2 flex flex-col">
              {drilledRecords.map((entry, index) => (
                <li key={index}>
                  <button
                    className="group/row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                    onClick={() => {
                      setOpened(entry);
                    }}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {titleOf(entry)}
                    </span>
                    <CaretRightIcon className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** A record as a tree: every field a row, containers folded until pressed. */
function Fields({ record }: { record: Json }) {
  const entries = Object.entries(record).filter(
    ([, value]) => value !== null && value !== "",
  );
  return (
    <div className="flex flex-col text-[13px] leading-5">
      {entries.map(([key, value]) => (
        <TreeRow depth={0} key={key} name={key} value={value} />
      ))}
    </div>
  );
}

/**
 * The head of one pane: what it shows, where that came from, and the way to
 * read it again. An app's answers change under it (a selection in a design
 * tool, a new page) and nothing tells the page, so each pane asks again on
 * its own, never the whole inspector.
 */
function PaneHeader({
  copyText,
  isFetching,
  meta,
  onBack,
  onRefresh,
  title,
}: {
  /** What Copy puts on the clipboard: the answer as the app gave it. */
  copyText?: string;
  isFetching: boolean;
  meta?: string;
  /** Back to the record this one was opened from, when it was. */
  onBack?: () => void;
  onRefresh: () => void;
  title: string;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-border px-4 py-2.5">
      {onBack ? (
        <button
          aria-label="Back"
          className="-ml-1.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <CaretLeftIcon className="size-3.5" weight="bold" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-5 font-semibold">{title}</p>
        {meta ? (
          <p className="truncate text-[11px] text-muted-foreground tabular-nums">
            {meta}
          </p>
        ) : null}
      </div>
      {copyText ? (
        <CopyButton
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          iconSize={14}
          label={`Copy ${title}`}
          onCopy={async () => {
            await navigator.clipboard.writeText(copyText);
          }}
          tooltip="Copy"
        />
      ) : null}
      <button
        aria-label={`Read ${title} again`}
        className="-mr-1.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        disabled={isFetching}
        onClick={onRefresh}
        title="Refresh"
        type="button"
      >
        <ArrowClockwiseIcon
          className={cn("size-3.5", isFetching && "animate-spin")}
        />
      </button>
    </div>
  );
}

function Records({
  filters,
  onFilter,
  onPick,
  onReading,
  picked,
  reads,
  slug,
  tool,
}: {
  filters: Record<string, string>;
  onFilter: (name: string, value: string) => void;
  onPick: (index: number) => void;
  onReading: (reading: InspectorReading | undefined) => void;
  picked: number | undefined;
  reads: Tool[];
  slug: string;
  tool: Tool;
}) {
  const args = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== ""),
  );
  const answer = useQuery({
    ...rpcClient.apps.read.queryOptions({
      input: { args, slug, tool: tool.name },
    }),
    staleTime: STALE_MS,
  });
  const facets = tool.params.filter((param) => param.enum?.length);
  const parsed = answer.data ? parse(answer.data.text) : undefined;
  const isList =
    answer.data !== undefined &&
    !answer.data.isError &&
    answer.data.images.length === 0 &&
    isListAnswer(parsed);
  const records = isList ? recordsOf(parsed) : [];
  // A list of one is that one: it opens without being pressed.
  const shownIndex = picked ?? (records.length === 1 ? 0 : undefined);
  const record = shownIndex === undefined ? undefined : records[shownIndex];
  const facetBar =
    facets.length > 0 ? (
      <div className="flex flex-wrap gap-1 border-b border-border p-1.5">
        {facets.map((facet) =>
          ["", ...(facet.enum ?? [])].map((value) => (
            <button
              className={cn(
                "rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent",
                (filters[facet.name] ?? "") === value &&
                  "bg-accent text-foreground",
              )}
              key={`${facet.name}:${value}`}
              onClick={() => {
                onFilter(facet.name, value);
              }}
              type="button"
            >
              {value === "" ? `Any ${facet.name}` : value}
            </button>
          )),
        )}
      </div>
    ) : null;

  if (answer.isPending) {
    return (
      <>
        <div className="min-w-0 border-r border-border">
          {facetBar}
          <div className="p-1.5">
            <SkeletonRows count={10} />
          </div>
        </div>
        <div className="min-w-0 p-4">
          <SkeletonFields />
        </div>
      </>
    );
  }

  // An answer that is not a list is read whole, across both columns: a
  // record, a picture, a block of code, a sentence.
  if (!isList) {
    return (
      <div className="col-span-2 flex min-w-0 flex-col">
        {facetBar}
        <PaneHeader
          copyText={answer.data?.text || undefined}
          isFetching={answer.isFetching}
          onRefresh={() => void answer.refetch()}
          title={labelOf(tool)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <WholeAnswer
            answer={answer.isError ? undefined : answer.data}
            error={answer.isError ? answer.error.message : undefined}
            onReading={onReading}
            parsed={parsed}
            reading={{ args, title: labelOf(tool), tool: tool.name }}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-w-0 flex-col border-r border-border">
        {facetBar}
        <PaneHeader
          isFetching={answer.isFetching}
          meta={`${records.length} ${records.length === 1 ? "item" : "items"}`}
          onRefresh={() => void answer.refetch()}
          title={labelOf(tool)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {records.length === 0 ? (
            <p className="p-2 text-muted-foreground">Nothing here.</p>
          ) : (
            records.map((entry, index) => (
              <button
                className={cn(
                  "group/row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent",
                  index === shownIndex && "bg-accent font-medium",
                )}
                // Records carry no stable key the inspector can know of.

                key={index}
                onClick={() => {
                  onPick(index);
                }}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">
                  {titleOf(entry)}
                </span>
                <CaretRightIcon
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100",
                    index === shownIndex && "opacity-100",
                  )}
                />
              </button>
            ))
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-col">
        {record ? (
          <Detail
            isSourceFetching={answer.isFetching}
            key={`${tool.name}:${String(shownIndex)}`}
            onReading={onReading}
            onRefreshSource={() => void answer.refetch()}
            reads={reads}
            record={record}
            slug={slug}
            source={tool}
            sourceArgs={args}
          />
        ) : (
          <p className="p-4 text-muted-foreground">Pick a row to read it.</p>
        )}
      </div>
    </>
  );
}

function Section({
  children,
  name,
}: {
  children: React.ReactNode;
  name: string;
}) {
  return (
    <section className="mt-6 flex min-h-0 min-w-0 flex-1 animate-in flex-col duration-300 fade-in-0">
      <p className="mb-2.5 text-[13px] font-medium text-muted-foreground">
        Browse {name}
      </p>
      {children}
    </section>
  );
}

function SkeletonFields() {
  return (
    <div className="grid grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)] gap-x-4 gap-y-3">
      {ROW_WIDTHS.map((width) => (
        <div className="contents" key={width}>
          <Skeleton className="h-3 w-16" />
          <Skeleton className={cn("h-3.5", width)} />
        </div>
      ))}
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: count }, (_, index) => (
        // Placeholders have nothing but their place to be keyed by.

        <div className="flex h-8 items-center px-2" key={index}>
          <Skeleton
            className={cn("h-3.5", ROW_WIDTHS[index % ROW_WIDTHS.length])}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A tool that does not run from here, described: what it says it does and
 * what it takes. For one that changes things, what would change is said
 * plainly, since that is why it is here rather than a button.
 */
function ToolSheet({ appName, tool }: { appName: string; tool: Tool }) {
  return (
    <div className="col-span-2 flex min-w-0 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <p className="truncate text-[13px] leading-5 font-semibold">
          {labelOf(tool)}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {tool.isRead
            ? "Reads something you name. Ask in a chat to use it."
            : `Changes things in ${appName}. Runs only when you ask in a chat.`}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          {tool.description ? <Markdown markdown={tool.description} /> : null}
          {tool.params.length > 0 ? (
            <dl className="grid grid-cols-[minmax(6rem,11rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t border-border pt-4">
              {tool.params.map((param) => (
                <div className="contents" key={param.name}>
                  <dt className="min-w-0">
                    <span className="block truncate font-mono text-xs">
                      {param.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {[param.type, param.required ? "required" : undefined]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </dt>
                  <dd className="min-w-0 text-[13px] leading-5">
                    {param.description}
                    {param.enum?.length ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {param.enum.map((value) => (
                          <span
                            className="rounded-md bg-muted px-1.5 py-px font-mono text-xs"
                            key={value}
                          >
                            {value}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Tells the page what is open, by value, and takes it back on the way out. */
function useReportReading(
  onReading: (reading: InspectorReading | undefined) => void,
  /** Null while something opened from it is reporting instead. */
  reading: InspectorReading | null,
) {
  const key = JSON.stringify(reading);
  useEffect(() => {
    const current = JSON.parse(key) as InspectorReading | null;
    if (current === null) {
      return;
    }
    onReading(current);
    return () => {
      onReading(undefined);
    };
  }, [key, onReading]);
}

/** An answer read whole: the error it is, the pictures in it, then its words. */
function WholeAnswer({
  answer,
  error,
  onReading,
  parsed,
  reading,
}: {
  answer: RPCOutput["apps"]["read"] | undefined;
  error: string | undefined;
  onReading: (reading: InspectorReading | undefined) => void;
  parsed: unknown;
  reading: InspectorReading;
}) {
  useReportReading(onReading, reading);
  if (error !== undefined || !answer) {
    return <p className="text-muted-foreground">{error}</p>;
  }
  if (answer.isError) {
    return <p className="text-muted-foreground">{answer.text}</p>;
  }
  const sequence =
    parsed === undefined ? parseSequence(answer.text) : undefined;
  return (
    <div className="flex flex-col gap-4">
      {answer.images.map((src) => (
        <img
          alt=""
          className="max-w-full self-start"
          key={src.slice(-64)}
          src={src}
        />
      ))}
      {isObject(parsed) ? (
        <Fields record={parsed} />
      ) : answer.text === "" ? null : sequence ? (
        sequence.map((value, index) => (
          <div
            className="border-t border-border pt-4 first:border-0 first:pt-0"
            // The values have no identity beyond their order.

            key={index}
          >
            {isObject(value) ? (
              <Fields record={value} />
            ) : (
              <Leaf value={value} />
            )}
          </div>
        ))
      ) : /^\s*[[{]/.test(answer.text) || looksLikeCode(answer.text) ? (
        <CodeAndProse text={answer.text} />
      ) : (
        <Markdown markdown={answer.text} />
      )}
    </div>
  );
}

/** How far each level of the tree sits in from the one it opened from. */
const TREE_INDENT_PX = 16;

/** A plain value, drawn by what it is. */
function Leaf({ name, value }: { name?: string; value: unknown }) {
  // A count of milliseconds or seconds under a name that says it is a time.
  if (
    typeof value === "number" &&
    name !== undefined &&
    /(?:at|date|time|timestamp)$/i.test(name) &&
    value > 1e9 &&
    value < 1e14
  ) {
    return (
      <span title={String(value)}>
        {new Date(value > 1e11 ? value : value * 1000).toLocaleString()}
      </span>
    );
  }
  if (typeof value === "string") {
    if (isLink(value)) {
      return <LinkValue url={value} />;
    }
    return value.length > 160 || value.includes("\n") ? (
      <LongText text={value} />
    ) : (
      <span className="wrap-break-word">{value}</span>
    );
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? (
      <span className="text-muted-foreground">none</span>
    ) : (
      <span className="flex flex-wrap gap-1">
        {value.map((entry, index) => (
          <span
            className="rounded-md bg-muted px-1.5 py-px text-xs"

            key={index}
          >
            {String(entry)}
          </span>
        ))}
      </span>
    );
  }
  if (isObject(value)) {
    return <span className="text-muted-foreground">none</span>;
  }
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">null</span>;
  }
  return <span className="tabular-nums">{JSON.stringify(value)}</span>;
}

function LinkValue({ url }: { url: string }) {
  const { openPage } = useOrchestrator();
  return (
    <button
      className="max-w-full truncate text-left text-primary hover:underline"
      onClick={() => {
        if (/^https?:\/\//i.test(url)) {
          openPage(url, { newTab: true });
          return;
        }
        void safe(rpcClient.utils.openExternalLink.call({ url })).then(
          ([error]) => {
            if (error) {
              toast.error("Could not open that link");
            }
          },
        );
      }}
      title={url}
      type="button"
    >
      {url}
    </button>
  );
}

function LongText({ text }: { text: string }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <div>
      <p
        className={cn(
          "leading-5 wrap-break-word whitespace-pre-wrap",
          !isOpen && "line-clamp-4",
        )}
      >
        {text}
      </p>
      {text.length > 400 || text.split("\n").length > 6 ? (
        <button
          className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpen(!isOpen);
          }}
          type="button"
        >
          {isOpen ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * One field: its name, then its value right beside it rather than across a
 * column, and a copy for the value that appears beside the value itself. A
 * container is a caret and a one-line summary until it is opened.
 */
function TreeRow({
  depth,
  name,
  value: raw,
}: {
  depth: number;
  name: string;
  value: unknown;
}) {
  // JSON a server sent inside a string is unfolded like any other.
  const nested =
    typeof raw === "string" && /^\s*[[{]/.test(raw) ? parse(raw) : undefined;
  const value =
    nested !== undefined && typeof nested === "object" ? nested : raw;
  const children = childrenOf(value);
  const [isOpen, setOpen] = useState(
    depth === 0 && children !== undefined && children.length <= 4,
  );
  const toggle = () => {
    setOpen(!isOpen);
  };
  return (
    <>
      <div
        className="group/row flex min-w-0 items-start gap-1.5 rounded-md py-0.5 pr-1 hover:bg-accent/40"
        style={{ paddingLeft: depth * TREE_INDENT_PX + 4 }}
      >
        {children ? (
          <button
            aria-expanded={isOpen}
            aria-label={isOpen ? `Fold ${name}` : `Open ${name}`}
            className="mt-1 grid size-3 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
            onClick={toggle}
            type="button"
          >
            <CaretRightIcon
              className={cn(
                "size-3 transition-transform",
                isOpen && "rotate-90",
              )}
              weight="bold"
            />
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="max-w-[40%] shrink-0 truncate text-muted-foreground">
          {name}
        </span>
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <div className="min-w-0">
            {children ? (
              <button
                className="text-left text-muted-foreground hover:text-foreground"
                onClick={toggle}
                type="button"
              >
                {summaryOf(value, children.length)}
              </button>
            ) : (
              <Leaf name={name} value={value} />
            )}
          </div>
          <CopyButton
            className="mt-0.5 grid size-4 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100"
            iconSize={11}
            label={`Copy ${name}`}
            onCopy={async () => {
              await navigator.clipboard.writeText(
                typeof value === "string"
                  ? value
                  : JSON.stringify(value, null, 2),
              );
            }}
          />
        </div>
      </div>
      {children && isOpen
        ? children.map(([key, entry], index) => (
            <TreeRow
              depth={depth + 1}
              // Keys repeat in arrays of arrays; the order is the identity.

              key={`${key}:${index}`}
              name={key}
              value={entry}
            />
          ))
        : null}
    </>
  );
}
