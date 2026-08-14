import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { GraphIcon } from "@phosphor-icons/react/Graph";
import { useSetAtom } from "jotai";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import { useNearViewport } from "../hooks/use-near-viewport";
import { renderMermaid, toDiagramImageUrl } from "../lib/mermaid";
import {
  blockToolbarButtonClassName,
  CodeBlock,
  CodeWithCopy,
} from "./code-block";
import { CopyButton } from "./copy-button";
import { useTheme } from "./theme-provider";

/** How long to wait before asking again for a diagram whose render threw, and
 * how many times. Spaced out and few: a fetch still failing after this is not
 * the transient blip the retry is for. */
const RETRY_DELAYS_MS = [1000, 5000];

/**
 * A ```mermaid fence, rendered as a diagram once its source parses.
 *
 * Until then — and permanently, for source that never parses — this is the
 * highlighted code block a mermaid fence rendered as before diagrams existed.
 * That fallback is the whole error strategy: streaming markdown spends most of
 * its life half-written, so there is no moment at which a parse failure is
 * worth telling the reader about.
 */
export const MermaidDiagram = ({
  code,
  language,
}: {
  code: string;
  language: string;
}) => {
  const { resolvedTheme } = useTheme();
  const openFilePreview = useSetAtom(openFilePreviewAtom);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>();
  const [showSource, setShowSource] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Same reason `CodeBlock` defers: the fence is rewritten on every token, and
  // a mermaid render is far too expensive to run at that rate.
  const deferredCode = useDeferredValue(code);
  // A message can carry many diagrams, and laying one out is main-thread work
  // measured in tens of milliseconds. Rendering the ones far below the fold on
  // mount spends all of it before the reader has scrolled to any of them.
  const { isNear, ref: viewportRef } = useNearViewport<HTMLDivElement>();

  useEffect(() => {
    const source = deferredCode.trim();
    if (!source || !isNear) {
      return;
    }

    let isCancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    void renderMermaid({ code: source, theme: resolvedTheme })
      .then((rendered) => {
        // `undefined` means the source did not parse, which while a message
        // streams is simply "not finished yet". Holding the last good render
        // (or the source block, when there has not been one) is what keeps a
        // half-written graph from flashing between states.
        if (!isCancelled && rendered) {
          setSvg(rendered);
        }
      })
      .catch(() => {
        // Keep whatever is on screen, then ask again. A throw here is nearly
        // always the chunk fetch dropping, and while `loadMermaid` will refetch
        // for the next caller, a diagram in a finished message never becomes
        // one: its source, theme and visibility have all settled, so nothing
        // would re-run this effect. Without a retry of its own, this one fence
        // stays a code block for the rest of the session while every diagram
        // that mounts later recovers.
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
    };
  }, [attempt, deferredCode, isNear, resolvedTheme]);

  if (!svg) {
    // Also where a diagram waiting on the viewport sits, which is the same
    // thing the reader would have seen mid-stream anyway.
    return (
      <CodeWithCopy content={code} ref={viewportRef}>
        <CodeBlock code={code} language={language} />
      </CodeWithCopy>
    );
  }

  const openInPreview = () => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    // Read the background actually in effect rather than naming a color, so
    // the exported image matches the theme the diagram was rendered for.
    const url = toDiagramImageUrl({
      background: globalThis.getComputedStyle(surface).backgroundColor,
      svg,
    });
    if (url) {
      openFilePreview({
        filename: "diagram.svg",
        mimeType: "image/svg+xml",
        url,
      });
    }
  };

  return (
    <div
      className="group/block-toolbar relative isolate my-4"
      ref={viewportRef}
    >
      {/* Revealed on focus as well as hover, so tabbing through never lands
          on an invisible control. */}
      <div className="absolute top-1 right-1 z-10 flex items-center gap-1 opacity-0 group-hover/block-toolbar:opacity-100 focus-within:opacity-100">
        {!showSource && (
          <button
            aria-label="Open diagram"
            className={blockToolbarButtonClassName}
            onClick={openInPreview}
            title="Open diagram"
            type="button"
          >
            <ArrowsOutSimpleIcon size={12} />
          </button>
        )}
        <button
          aria-label={showSource ? "Show diagram" : "Show source"}
          className={blockToolbarButtonClassName}
          onClick={() => {
            setShowSource(!showSource);
          }}
          title={showSource ? "Show diagram" : "Show source"}
          type="button"
        >
          {showSource ? <GraphIcon size={12} /> : <CodeIcon size={12} />}
        </button>
        <CopyButton
          className={blockToolbarButtonClassName}
          iconSize={12}
          onCopy={async () => {
            await navigator.clipboard.writeText(code);
          }}
        />
      </div>

      {showSource ? (
        <CodeBlock code={code} language={language} />
      ) : (
        // `not-prose` on the surface rather than the whole block: the
        // typography styles size and space SVG text as if it were prose, which
        // moves labels off the shapes they name, but the source view above is
        // a code block and wants exactly the styling every other one gets.
        <div
          className="not-prose overflow-x-auto rounded-md border border-border bg-background"
          ref={surfaceRef}
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
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      )}
    </div>
  );
};
