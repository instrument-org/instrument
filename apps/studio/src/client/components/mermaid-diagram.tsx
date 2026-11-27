import { lookAtAtom } from "@/client/components/window/look-at";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { GraphIcon } from "@phosphor-icons/react/Graph";
import { useSetAtom } from "jotai";
import type { Mounted } from "pele/lazy";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import { useNearViewport } from "../hooks/use-near-viewport";
import { loadDiagram, toDiagramImageUrl } from "../lib/mermaid";
import { cn } from "../lib/utils";
import {
  BlockToolbarButton,
  blockToolbarButtonClassName,
  CodeBlock,
  CodeWithCopy,
} from "./code-block";
import { CopyButton } from "./copy-button";
import { useReleaseAutoScroll } from "./transcript-scroll-context";

/** How long to wait before asking again for a diagram whose render threw, and
 * how many times. Spaced out and few: a fetch still failing after this is not
 * the transient blip the retry is for. */
const RETRY_DELAYS_MS = [1000, 5000];

/**
 * A ```mermaid fence, drawn as a diagram once its source parses.
 *
 * Until then — and permanently, for source that never parses — this is the
 * highlighted code block a mermaid fence rendered as before diagrams existed.
 * That fallback is the whole error strategy: streaming markdown spends most of
 * its life half-written, so there is no moment at which a parse failure is
 * worth telling the reader about.
 *
 * Pele draws straight into the host below and redraws it as the column's
 * width changes, so React renders the frame around the drawing and never the
 * drawing itself. Its colors are CSS variables (`.mermaid-diagram`), so a theme
 * change recolors a drawn diagram without drawing it again.
 */
export const MermaidDiagram = ({
  code,
  language,
}: {
  code: string;
  language: string;
}) => {
  const setLookAt = useSetAtom(lookAtAtom);
  const releaseAutoScroll = useReleaseAutoScroll();
  const hostRef = useRef<HTMLDivElement>(null);
  // Whether the host shows a drawing, as pele last reported.
  const [isDrawn, setIsDrawn] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Same reason `CodeBlock` defers: the fence is rewritten on every token, and
  // laying a diagram out is far too expensive to run at that rate.
  const deferredCode = useDeferredValue(code);
  // A message can carry many diagrams, and laying one out is main-thread work.
  // Drawing the ones far below the fold on mount spends all of it before the
  // reader has scrolled to any of them.
  const { isNear, ref: viewportRef } = useNearViewport<HTMLDivElement>();

  useEffect(() => {
    const host = hostRef.current;
    const source = deferredCode.trim();
    if (!host || !source || !isNear) {
      return;
    }

    let isCancelled = false;
    let mounted: Mounted | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    void loadDiagram(source)
      .then((draw) => {
        // `undefined` means the source did not parse, which while a message
        // streams is simply "not finished yet". Leaving the host alone holds
        // the last good drawing (or the source block, when there has not been
        // one), which keeps a half-written graph from flashing between states.
        if (isCancelled || !draw) {
          return;
        }
        mounted = draw(host, {
          // A drawing can still fail once the source parses (past pele's size
          // limit for its output, say), and pele leaves its error in the host,
          // so the source block takes its place.
          onError: () => {
            setIsDrawn(false);
          },
          onRender: () => {
            setIsDrawn(true);
          },
        });
      })
      .catch(() => {
        // Keep whatever is on screen, then ask again. A throw here is nearly
        // always a chunk fetch dropping, and while the loaders fetch again
        // for the next caller, a diagram in a finished message never becomes
        // one: its source and visibility have both settled, so nothing would
        // re-run this effect. Without a retry of its own, this one fence stays
        // a code block for the rest of the session while every diagram that
        // mounts later recovers.
        const delay = RETRY_DELAYS_MS[attempt];
        if (isCancelled || delay === undefined) {
          return;
        }
        retryTimer = setTimeout(() => {
          setAttempt(attempt + 1);
        }, delay);
      });

    return () => {
      isCancelled = true;
      clearTimeout(retryTimer);
      // Stops pele following the host's width. The drawing itself stays until
      // the next one replaces it.
      mounted?.destroy();
    };
  }, [attempt, deferredCode, isNear]);

  const openInPreview = () => {
    const svg = hostRef.current?.querySelector(":scope > svg");
    const url = svg instanceof SVGSVGElement && toDiagramImageUrl(svg);
    if (url) {
      setLookAt({
        kind: "picture",
        picture: {
          filename: "diagram.svg",
          mimeType: "image/svg+xml",
          url,
        },
      });
    }
  };

  return (
    <div
      className={
        isDrawn ? "group/block-toolbar relative isolate my-4" : "relative"
      }
      ref={viewportRef}
    >
      {isDrawn ? (
        // Revealed on focus as well as hover, so tabbing through never lands
        // on an invisible control.
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1 opacity-0 group-hover/block-toolbar:opacity-100 focus-within:opacity-100">
          {!showSource && (
            <BlockToolbarButton
              icon={ArrowsOutSimpleIcon}
              label="Open diagram"
              onClick={openInPreview}
            />
          )}
          <BlockToolbarButton
            icon={showSource ? GraphIcon : CodeIcon}
            label={showSource ? "Show diagram" : "Show source"}
            onClick={() => {
              // The source and the diagram rarely stand the same height, so
              // the swap moves the transcript under a follow-bottom scroller.
              releaseAutoScroll();
              setShowSource(!showSource);
            }}
          />
          <CopyButton
            className={blockToolbarButtonClassName}
            iconSize={12}
            onCopy={async () => {
              await navigator.clipboard.writeText(code);
            }}
            tooltip="Copy source"
          />
        </div>
      ) : (
        // Also where a diagram waiting on the viewport sits, which is the same
        // thing the reader would have seen mid-stream anyway.
        <CodeWithCopy content={code}>
          <CodeBlock code={code} language={language} />
        </CodeWithCopy>
      )}

      {isDrawn && showSource && <CodeBlock code={code} language={language} />}

      {/* `not-prose` on the surface rather than the whole block: the
          typography styles size and space SVG text as if it were prose, which
          moves labels off the shapes they name, but the source view above is
          a code block and wants exactly the styling every other one gets.

          The surface stays in the page while the source block stands in for
          it, laid out at the column's width with no height and nothing
          visible, so pele's first drawing is already the one fitted to the
          column. */}
      <div
        className={cn(
          "mermaid-diagram not-prose overflow-x-auto rounded-md border border-border bg-background scroll-fade-none",
          !isDrawn && "invisible absolute inset-x-0 top-0 h-0 overflow-hidden",
          showSource && "hidden",
        )}
      >
        {/* A diagram wider than the chat column shrinks to fit rather than
            pushing the column open; the scroller above is the escape hatch
            for one that cannot shrink any further, and the toolbar's expand
            is how a large one is actually read.

            Plain markup rather than a control: a diagram is something to
            read, and wrapping it in a button made its labels unselectable
            and gave the whole surface one meaning. */}
        <div
          className="p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          ref={hostRef}
        />
      </div>
    </div>
  );
};
