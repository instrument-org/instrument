import { cn } from "@/client/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  Fragment,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { FileLoading } from "../file-loading";
import { SessionMarkdown } from "../session-markdown";
import {
  type AnsiLine,
  type AnsiStyle,
  type NotebookCell,
  type NotebookOutput,
  parseNotebook,
} from "./notebook-format";
import { NotebookHtml } from "./notebook-html";
import { useFindHighlights } from "./use-find-highlights";
import {
  ViewerFindControl,
  ViewerToolbar,
  ViewerToolbarSpacer,
} from "./viewer-toolbar";

/**
 * A read-only notebook, in the shape GitHub renders one: cells top to bottom,
 * execution counts in the gutter, outputs under the code that produced them.
 *
 * Almost nothing here is new. Markdown cells are the same renderer the
 * transcript uses, code cells the same Shiki highlighting, and the chrome the
 * same toolbar every other document viewer has -- what a notebook needed that
 * Studio did not already own is the parsing, which lives in
 * `notebook-format.ts`.
 *
 * No zoom control, for the same reason the CSV grid has none: this is plain DOM
 * text that the window's own zoom already scales, so a second scale factor
 * inside it would only be a way for the two to disagree.
 */
export function NotebookViewer({ url }: { url: string }) {
  const { data, error, isLoading } = useQuery({
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`);
      }
      return response.text();
    },
    queryKey: ["notebook-file", url],
    retry: false,
  });

  if (isLoading) {
    return <FileLoading />;
  }

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`,
  // which owns the "preview unavailable" card for every viewer.
  if (error) {
    throw error;
  }

  return <NotebookDocument text={data ?? ""} />;
}

const ANSI_COLOR_CLASSES: Record<string, string> = {
  black: "text-foreground",
  blue: "text-blue-600 dark:text-blue-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
  green: "text-green-600 dark:text-green-400",
  magenta: "text-fuchsia-600 dark:text-fuchsia-400",
  red: "text-red-600 dark:text-red-400",
  // Terminal "white" is the default foreground of a dark terminal, so it is
  // the one color that must not be taken literally on a light theme.
  white: "text-muted-foreground",
  yellow: "text-yellow-600 dark:text-yellow-400",
};

// The element cells are scrolled inside, handed down so each one can be
// observed against it. A cell is several levels below the scroller and has no
// other way to reach it.
const NotebookScrollContext =
  createContext<null | RefObject<HTMLDivElement | null>>(null);

const OUTPUT_BLOCK_CLASS =
  "overflow-x-auto rounded-md border border-border/60 bg-muted/40 p-3 text-xs";

function ansiClassName(style: AnsiStyle) {
  return cn(
    style.color !== null && ANSI_COLOR_CLASSES[style.color],
    style.bold && "font-semibold",
  );
}

/** Terminal-ish output, with the styles the ANSI parser recovered. */
function AnsiText({ lines }: { lines: AnsiLine[] }) {
  return (
    <pre className="whitespace-pre-wrap">
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 && "\n"}
          {line.map((segment, index) => (
            <span className={ansiClassName(segment.style)} key={index}>
              {segment.text}
            </span>
          ))}
        </Fragment>
      ))}
    </pre>
  );
}

/**
 * The `In [n]` / `Out[n]` column.
 *
 * Hidden below a narrow container rather than dropped outright: the counts are
 * part of reading a notebook, but the artifact panel can be narrow enough that
 * spending fifty pixels of it on them costs more than they give. Measured
 * against the viewer's own container, since the panel is resizable and the
 * window is zoomable.
 */
function CellGutter({ label }: { label: string }) {
  return (
    <div className="hidden w-14 shrink-0 pt-2 text-right text-[0.6875rem] text-muted-foreground tabular-nums @min-[520px]/notebook:block">
      {label}
    </div>
  );
}

function NotebookCellView({
  cell,
  language,
}: {
  cell: NotebookCell;
  language: string;
}) {
  if (cell.type === "markdown") {
    // No remote images, for the same reason the HTML output sanitizer allows
    // none: a notebook is a file someone else wrote, and an `<img>` pointing
    // at a host is a request the moment it is opened -- no click, no consent,
    // an IP disclosed and the read confirmed. A notebook's own images are
    // embedded as attachments, so this costs the ordinary case nothing.
    return <SessionMarkdown allowRemoteImages={false} markdown={cell.source} />;
  }

  if (cell.type === "raw") {
    return (
      <pre className={cn(OUTPUT_BLOCK_CLASS, "text-muted-foreground")}>
        {cell.source}
      </pre>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <CellGutter
          label={
            cell.executionCount === null ? "In [ ]:" : `In [${cell.executionCount}]:`
          }
        />
        <NotebookCode code={cell.source} language={language} />
      </div>
      {cell.outputs.map((output, index) => (
        <div className="flex gap-2" key={index}>
          <CellGutter label={outputLabel(output)} />
          <div className="min-w-0 flex-1">
            <NotebookOutputView output={output} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One code cell, highlighted once it has been scrolled near.
 *
 * Highlighting is an RPC to the main process per call, so a notebook with a few
 * hundred code cells would otherwise open by issuing a few hundred of them at
 * once. The gate is on the highlighting alone, not on the cell: the code is in
 * the DOM as plain text from the first paint, which is what keeps find able to
 * reach every cell rather than only the ones someone has scrolled past.
 */
function NotebookCode({ code, language }: { code: string; language: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isNearViewport = useIsNearViewport(ref);
  const { highlightedHtml } = useSyntaxHighlighting({
    code: isNearViewport ? code : undefined,
    language,
  });

  return (
    <div className={cn(OUTPUT_BLOCK_CLASS, "min-w-0 flex-1")} ref={ref}>
      {highlightedHtml ? (
        // The markup is Shiki's, produced by our own main process from this
        // text -- not anything the notebook file supplied. Output the file did
        // supply goes through the sanitizer in `notebook-html.tsx` instead.
        <div dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }} />
      ) : (
        <pre>{code}</pre>
      )}
    </div>
  );
}

function NotebookDocument({ text }: { text: string }) {
  // Throws on a file this cannot read, which the surface turns into the
  // "preview unavailable" card.
  const notebook = useMemo(() => parseNotebook(text), [text]);

  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { activeMatch, goToMatch, matchCount, resetActiveMatch, styleSheet } =
    useFindHighlights({ containerRef: scrollRef, query });

  return (
    <>
      <style>{styleSheet}</style>

      <ViewerToolbar>
        <span className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {notebook.cells.length.toLocaleString()}{" "}
          {notebook.cells.length === 1 ? "cell" : "cells"}
        </span>
        <ViewerToolbarSpacer />
        <ViewerFindControl
          activeMatch={activeMatch}
          matchCount={matchCount}
          onNextMatch={() => {
            goToMatch(1);
          }}
          onPreviousMatch={() => {
            goToMatch(-1);
          }}
          onQueryChange={(next) => {
            setQuery(next);
            // A new query starts at its own first match rather than wherever
            // the previous one happened to be left.
            resetActiveMatch();
          }}
          query={query}
        />
      </ViewerToolbar>

      <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
        <div className="@container/notebook mx-auto flex max-w-4xl flex-col gap-6 p-4">
          <NotebookScrollContext value={scrollRef}>
            {notebook.cells.map((cell) => (
              <NotebookCellView
                cell={cell}
                key={cell.id}
                language={notebook.language}
              />
            ))}
          </NotebookScrollContext>
        </div>
      </div>
    </>
  );
}

function NotebookOutputView({ output }: { output: NotebookOutput }) {
  switch (output.type) {
    case "error": {
      return (
        <div className="overflow-x-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <AnsiText lines={output.traceback} />
        </div>
      );
    }
    case "html": {
      return <NotebookHtml html={output.html} />;
    }
    case "image": {
      return (
        <img alt={output.alt} className="max-w-full rounded-md" src={output.src} />
      );
    }
    case "json": {
      return <pre className={OUTPUT_BLOCK_CLASS}>{output.json}</pre>;
    }
    case "text": {
      return (
        <div
          className={cn(
            "overflow-x-auto px-1 text-xs",
            output.stream === "stderr" &&
              "rounded-md border border-destructive/30 bg-destructive/5 p-3",
          )}
        >
          <AnsiText lines={output.lines} />
        </div>
      );
    }
  }
}

function outputLabel(output: NotebookOutput): string {
  return output.type === "error" || output.prompt === null
    ? ""
    : `Out[${output.prompt}]:`;
}

/**
 * Whether an element has come within a screen or so of being scrolled to.
 *
 * Observed against the viewer's own scroll container rather than the viewport,
 * which is the difference between the lead below working and doing nothing at
 * all: `rootMargin` expands the root's rect, but the target is also clipped by
 * every scroll container between it and that root, and those clip rects are
 * not expanded. Rooted on the viewport, a cell below the fold of the notebook's
 * own scroller never intersects until it is genuinely on screen -- which is
 * exactly when it is too late to have started.
 *
 * One-way on purpose: once something has been seen it stays seen, so scrolling
 * back over a cell does not throw away work already done for it.
 */
function useIsNearViewport(ref: RefObject<HTMLElement | null>) {
  const scrollRef = useContext(NotebookScrollContext);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || isNear) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNear(true);
        }
      },
      { root: scrollRef?.current ?? null, rootMargin: "600px" },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isNear, ref, scrollRef]);

  return isNear;
}
