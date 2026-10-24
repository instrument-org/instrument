import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useState } from "react";

import {
  type Candidate,
  countOf,
  defaultPicks,
  isSelectable,
  type PickerRow,
  pickerRows,
  pickRange,
  shortDate,
  toggleAll,
  visibleCandidates,
} from "./chat-import-model";

/** A chat's row: a title line over a preview line. */
const CHAT_ROW_HEIGHT = 52;
const MONTH_ROW_HEIGHT = 32;

/**
 * The list of a source's chats, to pick which ones come in.
 *
 * Everything the person had starts picked, since bringing a whole history
 * over is the usual reason to be here: picking a few is Clear and then a few
 * presses, and a shift-click picks a run. A month's heading picks the month.
 * Chats the source made on its own wait behind a toggle that says how many,
 * and chats already here are marked and cannot be picked again.
 *
 * Thousands of rows are drawn a screenful at a time, so the list has a
 * scroller of its own that fills the page's height.
 */
export function ChatImportPicker({
  candidates,
  onImport,
  sourceName,
}: {
  candidates: Candidate[];
  onImport: (picked: Candidate[]) => void;
  sourceName: string;
}) {
  const [query, setQuery] = useState("");
  const [showIncidental, setShowIncidental] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() =>
    defaultPicks(candidates),
  );
  const [anchor, setAnchor] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const incidentalCount = candidates.filter(
    (candidate) => candidate.incidental,
  ).length;
  const visible = visibleCandidates(candidates, { query, showIncidental });
  const rows = pickerRows(visible, now);
  const visibleSelectable = visible
    .filter(isSelectable)
    .map((candidate) => candidate.sourceId);
  const pickedVisible = visibleSelectable.filter((id) => picked.has(id));
  const allState =
    pickedVisible.length === 0
      ? false
      : pickedVisible.length === visibleSelectable.length
        ? true
        : "indeterminate";
  const pickedCandidates = candidates.filter((candidate) =>
    picked.has(candidate.sourceId),
  );

  const press = (sourceId: string, isRange: boolean) => {
    setPicked((current) =>
      isRange && anchor
        ? pickRange(current, visible, { from: anchor, to: sourceId })
        : toggleAll(current, [sourceId]),
    );
    setAnchor(sourceId);
  };

  return (
    <div className="flex min-h-80 flex-1 basis-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <Checkbox
          aria-label="Select every chat in view"
          checked={allState}
          className="ml-2.5"
          disabled={visibleSelectable.length === 0}
          onCheckedChange={() => {
            setPicked((current) => toggleAll(current, visibleSelectable));
          }}
        />
        <span className="text-sm tabular-nums">
          {picked.size === 0
            ? "None selected"
            : `${picked.size.toLocaleString("en-US")} selected`}
        </span>
        {picked.size > 0 && (
          <Button
            className="h-7 px-2 text-xs"
            onClick={() => {
              setPicked(new Set());
            }}
            size="sm"
            variant="ghost"
          >
            Clear
          </Button>
        )}
        <div className="relative ml-auto w-64 max-w-full">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search chats"
            className="h-8 pl-8"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search chats"
            type="search"
            value={query}
          />
        </div>
      </div>

      {candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          {sourceName} doesn&rsquo;t have any chats to import.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border px-6 py-10 text-center text-sm text-muted-foreground">
          {query.trim()
            ? `No chats match “${query.trim()}”.`
            : `Every chat here is one ${sourceName} made on its own.`}
        </p>
      ) : (
        <PickerList
          onPickMonth={(ids) => {
            setPicked((current) => toggleAll(current, ids));
          }}
          onPress={press}
          now={now}
          picked={picked}
          rows={rows}
        />
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        {incidentalCount > 0 ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={showIncidental}
              onCheckedChange={(checked) => {
                setShowIncidental(checked === true);
                // Hiding them unpicks them, so what comes in is what the
                // list shows.
                if (checked !== true) {
                  setPicked(
                    (current) =>
                      new Set(
                        [...current].filter(
                          (id) =>
                            !candidates.some(
                              (candidate) =>
                                candidate.incidental &&
                                candidate.sourceId === id,
                            ),
                        ),
                      ),
                  );
                }
              }}
            />
            <span title="Chats that never got a reply, and runs an agent started on its own">
              Show {countOf(incidentalCount, "automatic chat")}
            </span>
          </label>
        ) : (
          <span />
        )}
        <Button
          disabled={pickedCandidates.length === 0}
          onClick={() => {
            onImport(pickedCandidates);
          }}
        >
          {pickedCandidates.length === 0
            ? "Import chats"
            : `Import ${countOf(pickedCandidates.length, "chat")}`}
        </Button>
      </div>
    </div>
  );
}

/** The rows, drawn a screenful at a time. */
function PickerList({
  now,
  onPickMonth,
  onPress,
  picked,
  rows,
}: {
  now: Date;
  onPickMonth: (ids: string[]) => void;
  onPress: (sourceId: string, isRange: boolean) => void;
  picked: ReadonlySet<string>;
  rows: PickerRow[];
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  // Rows are fixed heights, so only the scrollport is measured, in layout
  // px: inside the window's CSS `zoom` the default reads the on-screen rect.
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) =>
      rows[index]?.type === "month" ? MONTH_ROW_HEIGHT : CHAT_ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.key ?? index,
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
    overscan: 10,
  });

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto rounded-lg border"
      ref={setScroller}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) {
            return null;
          }
          return (
            <div
              className="absolute inset-x-0 top-0"
              key={item.key}
              style={{
                height: item.size,
                transform: `translateY(${item.start}px)`,
              }}
            >
              {row.type === "month" ? (
                <MonthRow
                  isFirst={item.index === 0}
                  label={row.label}
                  onPick={() => {
                    onPickMonth(row.selectable);
                  }}
                  picked={picked}
                  selectable={row.selectable}
                />
              ) : (
                <ChatRow
                  candidate={row.candidate}
                  isPicked={picked.has(row.candidate.sourceId)}
                  now={now}
                  onPress={(isRange) => {
                    onPress(row.candidate.sourceId, isRange);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A month's heading, whose box picks every chat under it that can be. */
function MonthRow({
  isFirst,
  label,
  onPick,
  picked,
  selectable,
}: {
  isFirst: boolean;
  label: string;
  onPick: () => void;
  picked: ReadonlySet<string>;
  selectable: string[];
}) {
  const count = selectable.filter((id) => picked.has(id)).length;
  return (
    <div
      className={cn(
        "flex h-full items-center gap-2.5 border-b bg-muted/40 px-2.5 text-xs font-medium text-muted-foreground",
        !isFirst && "border-t",
      )}
    >
      <Checkbox
        aria-label={`Select every chat from ${label}`}
        checked={
          count === 0
            ? false
            : count === selectable.length
              ? true
              : "indeterminate"
        }
        disabled={selectable.length === 0}
        onCheckedChange={onPick}
      />
      {label}
    </div>
  );
}

/**
 * One chat: its title and date over the first words the person wrote, and
 * where it was filed and how long it is. The whole row is the box.
 */
function ChatRow({
  candidate,
  isPicked,
  now,
  onPress,
}: {
  candidate: Candidate;
  isPicked: boolean;
  now: Date;
  onPress: (isRange: boolean) => void;
}) {
  const isImported = candidate.imported !== null;
  const details = [
    candidate.project,
    countOf(candidate.messages, "message"),
  ].filter(Boolean);

  return (
    <button
      aria-checked={isImported ? undefined : isPicked}
      className={cn(
        "flex size-full items-start gap-2.5 border-b px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        isImported ? "text-muted-foreground" : "hover:bg-accent/50",
        isPicked && "bg-accent/40",
      )}
      disabled={isImported}
      onClick={(event) => {
        onPress(event.shiftKey);
      }}
      // A shift-click picks a run of rows, which the browser would otherwise
      // also take as selecting the text between them.
      onMouseDown={(event) => {
        if (event.shiftKey) {
          event.preventDefault();
        }
      }}
      role={isImported ? undefined : "checkbox"}
      type="button"
    >
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
        {isImported ? (
          <CheckIcon aria-hidden className="size-3.5" />
        ) : (
          // Drawn as the Checkbox looks rather than as one, since the row is
          // already the control and a button cannot sit inside another.
          <span
            aria-hidden
            className={cn(
              "grid size-4 place-content-center rounded-[4px] border border-input shadow-xs dark:bg-input/30",
              isPicked &&
                "border-primary bg-primary text-primary-foreground dark:bg-primary",
            )}
          >
            {isPicked && <CheckIcon className="size-3.5" />}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {candidate.title || "Untitled chat"}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {isImported ? "Imported" : shortDate(candidate.updatedAt, now)}
          </span>
        </span>
        <span className="flex items-baseline gap-3 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {candidate.preview ?? ""}
          </span>
          <span className="max-w-[45%] shrink-0 truncate">
            {details.join(" · ")}
          </span>
        </span>
      </span>
    </button>
  );
}
