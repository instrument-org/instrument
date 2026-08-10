import { cn } from "@/client/lib/utils";

import { type TranscriptEdge } from "./use-transcript-edge";

/**
 * A line where the transcript stops, and the numbers underneath it.
 *
 * The transcript follows its own end, so the thing that reads as the page
 * jumping is not the end moving -- it is pinned -- but everything above it
 * moving to keep it pinned. That is invisible while it happens and obvious in
 * the numbers: a frame that draws *less* than the one before it pulls the whole
 * column down, and `delta` is negative exactly then.
 */
export function TranscriptEdgeOverlay({ edge }: { edge: TranscriptEdge }) {
  // Growth is what a transcript does; shrinking is the thing being hunted, so
  // only that is coloured. A step that neither grew nor shrank still reports,
  // because "0" is the answer to "did this frame move anything".
  const shrank = edge.delta !== undefined && edge.delta < 0;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      <div
        className={cn(
          "absolute inset-x-0 border-t border-dashed",
          shrank ? "border-destructive" : "border-brand-400",
        )}
        style={{ top: `${edge.offset.toString()}px` }}
      >
        <span
          className={cn(
            "absolute right-1 rounded-sm px-1 py-0.5 font-mono text-[10px] tabular-nums",
            // Above the line when there is no room below it, which is what the
            // end of a full transcript always looks like.
            edge.gap < 20 ? "bottom-0.5" : "top-0.5",
            shrank
              ? "bg-destructive text-white"
              : "bg-brand-400/15 text-muted-foreground",
          )}
        >
          {edge.contentHeight}px
          {edge.delta === undefined
            ? ""
            : ` ${edge.delta >= 0 ? "+" : ""}${edge.delta.toString()}`}
          {edge.gap > 0.5 ? ` · ${Math.round(edge.gap).toString()} below` : ""}
        </span>
      </div>
    </div>
  );
}
