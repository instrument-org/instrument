import { useAppZoomStyle } from "@/client/hooks/use-app-zoom";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useSyntaxHighlighting } from "@/client/hooks/use-syntax-highlighting";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import {
  formatBytes,
  type StoreId,
  type Task,
} from "@instrument-org/workspace/client";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { BracketsCurlyIcon } from "@phosphor-icons/react/BracketsCurly";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { XIcon } from "@phosphor-icons/react/X";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";

import { Button } from "../ui/button";
import { DialogOverlay } from "../ui/dialog";
import { keepOpenForToasts } from "../ui/dialog-dismiss";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import {
  type TranscriptFormat,
  useTranscriptActions,
} from "./transcript-actions";
import { highlightedLines } from "./transcript-highlight";
import {
  type TranscriptLandmark,
  transcriptLandmarks,
} from "./transcript-outline";

// Left, right and bottom breathing room, matching the file viewer so the two
// full-window surfaces sit on the same pixel.
const GUTTER = 12;

// What a row costs before it is measured, in the viewer's own layout px: one
// unwrapped line. Most lines are, so the scrollbar lands close and settles as
// the wrapped ones are measured.
const LINE_HEIGHT = 20;

export function TaskTranscriptViewer({
  onOpenChange,
  open,
  selectedSessionId,
  task,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedSessionId: StoreId.Session | undefined;
  task: Task;
}) {
  const [format, setFormat] = useState<TranscriptFormat>("markdown");
  const zoomStyle = useAppZoomStyle({
    paddingBottom: GUTTER,
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingTop: TOOLBAR_HEIGHT,
  });

  useBlockTabNavigation(open);

  const actions = useTranscriptActions({
    id: task.id,
    sessionId: selectedSessionId,
  });

  const { data, isPending } = useQuery(
    rpcClient.debug.sessionTranscript.queryOptions({
      input:
        open && selectedSessionId
          ? { format, id: task.id, sessionId: selectedSessionId }
          : skipToken,
    }),
  );

  const content = data?.content ?? "";

  // Everything derived from the transcript is computed here rather than in the
  // body, which re-renders on every scroll frame: splitting a few hundred
  // thousand lines and re-scanning them for landmarks per frame is the
  // difference between a scroll and a slideshow.
  const lines = content.split("\n");
  const landmarks = transcriptLandmarks(content, format);
  const { highlightedHtml } = useSyntaxHighlighting({
    code: content,
    language: format,
  });
  // Alignment only holds when the highlighter saw exactly this text; a result
  // still arriving for the format being switched away from would color the
  // wrong lines.
  const block = highlightedLines(highlightedHtml);
  const highlighted = block?.length === lines.length ? block : undefined;

  return (
    <DialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <DialogPrimitive.Portal>
        <DialogOverlay className="bg-black/50" />
        {/*
          `inset-0` is zero on all four sides, and zero is zero at any scale
          factor, so the self-applied zoom leaves this box covering exactly the
          real window while its contents scale with the rest of the app. Nothing
          inside is sized in `vw`/`vh`, which an element's own zoom does not
          rescale; the top inset is the plain toolbar constant, which does scale
          with it and so keeps clearing the window's own controls.
        */}
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          // Save raises a toast carrying a Reveal in Finder action, and the
          // toaster is outside this element, so without this the click that
          // acts on the save closes the thing that started it.
          onInteractOutside={keepOpenForToasts}
          style={zoomStyle}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-lg">
            <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
              <DialogPrimitive.Title className="shrink-0 text-sm font-medium text-dev-700 dark:text-dev-300">
                Transcript
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {task.title}
              </DialogPrimitive.Description>

              <Tabs
                onValueChange={(value) => {
                  setFormat(value as TranscriptFormat);
                }}
                value={format}
              >
                <TabsList>
                  <TabsTrigger value="markdown">
                    <FileTextIcon className="size-3.5" />
                    Markdown
                  </TabsTrigger>
                  <TabsTrigger value="json">
                    <BracketsCurlyIcon className="size-3.5" />
                    JSON
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {content
                  ? formatBytes(new TextEncoder().encode(content).length)
                  : ""}
              </span>

              <Button
                disabled={actions.isCopying || !selectedSessionId}
                onClick={() => {
                  actions.copy(format);
                }}
                size="sm"
                variant="ghost"
              >
                <CopyIcon className="size-4" />
                Copy
              </Button>
              <Button
                disabled={actions.isSaving || !selectedSessionId}
                onClick={() => {
                  actions.save(format);
                }}
                size="sm"
                variant="ghost"
              >
                <ArrowLineDownIcon className="size-4" />
                Save
              </Button>
              <DialogPrimitive.Close asChild>
                <Button aria-label="Close" size="icon-sm" variant="ghost">
                  <XIcon className="size-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>

            {isPending && selectedSessionId ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            ) : (
              <TranscriptBody
                highlighted={highlighted}
                landmarks={landmarks}
                lines={lines}
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function TranscriptBody({
  highlighted,
  landmarks,
  lines,
}: {
  highlighted: string[] | undefined;
  landmarks: TranscriptLandmark[];
  lines: string[];
}) {
  "use no memo";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: lines.length,
    estimateSize: () => LINE_HEIGHT,
    getScrollElement: () => scrollRef.current,
    // Lines wrap, so a row is as many lines tall as its content needs and has
    // to be measured. Both of these read layout px (`offsetHeight`), the units
    // the scroll offset and the estimates are already in; the defaults read
    // `getBoundingClientRect`, which is on-screen px and so overstates every
    // row and the viewport alike by the zoom factor.
    measureElement: (element) =>
      element instanceof HTMLElement ? element.offsetHeight : LINE_HEIGHT,
    observeElementRect: (instance, cb) => {
      const element = instance.scrollElement;
      if (!element) {
        return;
      }
      const report = () => {
        cb({ height: element.offsetHeight, width: element.offsetWidth });
      };
      report();
      const observer = new ResizeObserver(report);
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    },
    overscan: 12,
  });

  const rows = virtualizer.getVirtualItems();
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  const topLine = rows.find((row) => row.end > scrollOffset)?.index ?? 0;
  const activeLandmark = landmarks.findLast(
    (landmark) => landmark.line <= topLine,
  );

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? landmarks.filter((landmark) =>
        landmark.label.toLowerCase().includes(needle),
      )
    : landmarks;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-64 shrink-0 flex-col border-r">
        <div className="shrink-0 p-2">
          <Input
            aria-label="Filter outline"
            className="h-7 text-xs"
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            placeholder="Filter outline"
            value={filter}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {shown.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {landmarks.length === 0
                ? "Nothing to outline."
                : "No matching sections."}
            </p>
          ) : (
            shown.map((landmark) => (
              <button
                className={cn(
                  "block w-full truncate px-3 py-1 text-left text-xs hover:bg-accent",
                  landmark.depth === 0 && "font-medium",
                  landmark.depth === 2 && "pl-6 text-muted-foreground",
                  landmark === activeLandmark && "bg-accent font-medium",
                )}
                key={landmark.line}
                onClick={() => {
                  virtualizer.scrollToIndex(landmark.line, { align: "start" });
                }}
                title={landmark.label}
                type="button"
              >
                {landmark.label}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto" ref={scrollRef}>
        <div
          className="relative w-full font-mono text-xs"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {rows.map((row) => (
            <div
              className="absolute top-0 left-0 flex w-full"
              data-index={row.index}
              key={row.key}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <span className="w-14 shrink-0 pr-3 text-right leading-5 text-muted-foreground/60 tabular-nums select-none">
                {row.index + 1}
              </span>
              {highlighted ? (
                <span
                  className="min-w-0 flex-1 pr-4 leading-5 whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{
                    __html: highlighted[row.index] ?? "",
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 pr-4 leading-5 whitespace-pre-wrap">
                  {lines[row.index]}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
