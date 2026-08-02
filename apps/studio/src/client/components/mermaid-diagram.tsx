import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import { CodeIcon, GraphIcon } from "@phosphor-icons/react";
import { useSetAtom } from "jotai";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import { renderMermaid, toDiagramImageUrl } from "../lib/mermaid";
import {
  blockToolbarButtonClassName,
  CodeBlock,
  CodeWithCopy,
} from "./code-block";
import { CopyButton } from "./copy-button";
import { useTheme } from "./theme-provider";

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
  // Same reason `CodeBlock` defers: the fence is rewritten on every token, and
  // a mermaid render is far too expensive to run at that rate.
  const deferredCode = useDeferredValue(code);

  useEffect(() => {
    const source = deferredCode.trim();
    if (!source) {
      return;
    }

    let isCancelled = false;

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
        // A render that throws past a successful parse gets the same
        // treatment: keep whatever is on screen.
      });

    return () => {
      isCancelled = true;
    };
  }, [deferredCode, resolvedTheme]);

  if (!svg) {
    return (
      <CodeWithCopy content={code}>
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
    // `not-prose` because the surrounding typography styles size and space SVG
    // text as if it were prose, which moves labels off the shapes they name.
    <div className="group not-prose relative isolate my-4">
      <div className="absolute top-1 right-1 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100">
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
        <div
          className="overflow-x-auto rounded-md border border-border bg-background"
          ref={surfaceRef}
        >
          {/* A diagram wider than the chat column shrinks to fit rather than
              pushing the column open; the scroller above is the escape hatch
              for one that cannot shrink any further, and the click opens it
              full-window through the same preview the images use. */}
          <button
            className="block w-full p-3"
            onClick={openInPreview}
            title="Open diagram"
            type="button"
          >
            <div
              className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </button>
        </div>
      )}
    </div>
  );
};
