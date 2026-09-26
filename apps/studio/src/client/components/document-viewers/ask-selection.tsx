import {
  type AskAboutSelection,
  useAskAboutSelection,
} from "@/client/components/orchestrator/ask-about-selection";
import { OrchestratorContext } from "@/client/components/orchestrator/context";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  type ReferenceElement,
  shift,
} from "@floating-ui/dom";
import {
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { InstrumentGlyph } from "../wordmark";
import { AskSelectionContext, type AskTarget } from "./ask-selection-context";

/** How long after a drag ends a viewer dropping its selection is undone. */
const RESTORE_WINDOW_MS = 400;

/**
 * The floating "Ask Instrument" button, drawn as the Markdown editor's
 * selection toolbar draws it: the popover's raised card, the Instrument mark
 * in the brand's green beside a plain label. It follows its reference as the
 * document scrolls, and goes on Escape.
 */
export function AskButton({
  onAsk,
  onDismiss,
  reference,
}: {
  onAsk: () => void;
  onDismiss?: () => void;
  reference: ReferenceElement;
}) {
  const floating = useRef<HTMLDivElement>(null);
  const dismiss = useEffectEvent(() => {
    onDismiss?.();
  });

  useEffect(() => {
    const element = floating.current;
    if (!element) {
      return;
    }
    const place = () => {
      void computePosition(reference, element, {
        middleware: [offset(8), flip(), shift({ padding: 8 })],
        placement: "top",
        strategy: "fixed",
      }).then(({ x, y }) => {
        element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        element.style.visibility = "visible";
      });
    };
    const stop = autoUpdate(reference, element, place, {
      animationFrame: reference instanceof Range,
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismiss();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      stop();
      document.removeEventListener("keydown", onKey);
    };
  }, [reference]);

  return createPortal(
    <div
      className="invisible fixed top-0 left-0 z-50 rounded-xl bg-popover p-1 text-popover-foreground shadow-md"
      data-ask-selection
      ref={floating}
    >
      <button
        className="flex h-7 items-center gap-1.5 rounded-lg pr-2.5 pl-2 text-[13px] leading-none font-medium whitespace-nowrap text-foreground hover:bg-muted active:bg-accent"
        onClick={onAsk}
        // Kept from taking focus, which would clear the selection it asks about.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        type="button"
      >
        <InstrumentGlyph
          className="size-3.5 text-brand-600 dark:text-brand-400"
          size={14}
        />
        Ask Instrument
      </button>
    </div>,
    document.body,
  );
}

/**
 * Lets words picked in a document be handed to Instrument, for formats that
 * cannot be edited here and so cannot carry an editor's own "Ask" button.
 *
 * A text selection the browser can see (a DOCX page, a slide) is found here,
 * with its page or slide read off the viewer's own markup. A viewer that
 * keeps its selection elsewhere reports it through {@link useAskSelection}.
 * Either way the same button floats over the selection, and asking quotes
 * the words with where they are in the file.
 */
export function AskSelection({
  children,
  path,
}: {
  children: ReactNode;
  path: string;
}) {
  const orchestrator = useContext(OrchestratorContext);
  const ask = useAskAboutSelection();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [target, setTarget] = useState<AskTarget | null>(null);

  useEffect(() => {
    if (!root || !orchestrator) {
      return;
    }
    let pressed = false;
    const read = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return null;
      }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        return null;
      }
      const quote = selection.toString().trim();
      if (!quote) {
        return null;
      }
      const location = locateInMarkup(range);
      return {
        quote,
        reference: range,
        ...(location ? { location } : {}),
      } satisfies AskTarget;
    };
    const onDown = () => {
      pressed = true;
      setTarget(null);
    };
    // A text selection that went away takes its button with it; one a viewer
    // reported for itself is the viewer's to take down.
    const update = () => {
      const next = read();
      setTarget(
        (current) =>
          next ?? (current?.reference instanceof Range ? null : current),
      );
    };
    // The range a drag built, as the pointer let go. The DOCX viewer drops
    // the browser's selection just after release in read-only mode (it places
    // a caret), so a selection that collapses within a moment of it is put
    // back, once.
    let released: null | { range: Range; until: number } = null;
    const onUpInside = () => {
      const selection = document.getSelection();
      released =
        selection && !selection.isCollapsed && selection.rangeCount > 0
          ? {
              range: selection.getRangeAt(0).cloneRange(),
              until: performance.now() + RESTORE_WINDOW_MS,
            }
          : null;
    };
    const restore = () => {
      const selection = document.getSelection();
      const kept = released;
      if (
        !kept ||
        !selection?.isCollapsed ||
        performance.now() > kept.until ||
        !kept.range.startContainer.isConnected
      ) {
        return false;
      }
      released = null;
      selection.removeAllRanges();
      selection.addRange(kept.range);
      return true;
    };
    // Shown once the drag ends, not while it is still building.
    const onUp = () => {
      pressed = false;
      requestAnimationFrame(update);
    };
    const onChange = () => {
      if (!pressed && !restore()) {
        update();
      }
    };
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointerup", onUpInside, true);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("selectionchange", onChange);
    return () => {
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUpInside, true);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [orchestrator, root]);

  // Stable, since viewers subscribe to their engine's selection events with it.
  const value = useMemo(
    () => (orchestrator ? { present: setTarget } : null),
    [orchestrator],
  );

  return (
    <AskSelectionContext value={value}>
      <div className="contents" ref={setRoot}>
        {children}
      </div>
      {target && (
        <AskButton
          onAsk={() => {
            const { location, quote } = target;
            setTarget(null);
            void Promise.resolve(quote).then((words) => {
              ask({
                path,
                quote: words,
                ...(location ? { location } : {}),
              } satisfies AskAboutSelection);
            });
          }}
          onDismiss={() => {
            setTarget(null);
          }}
          reference={target.reference}
        />
      )}
    </AskSelectionContext>
  );
}

/**
 * The page or slide a DOM selection starts on, read off the attributes the
 * DOCX and PPTX viewers put on each page's wrapper.
 */
function locateInMarkup(range: Range) {
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const end =
    range.endContainer instanceof Element
      ? range.endContainer
      : range.endContainer.parentElement;
  for (const [attribute, noun] of [
    ["data-docx-page-index", "page"],
    ["data-rpv-slide-index", "slide"],
  ] as const) {
    const from = start?.closest(`[${attribute}]`)?.getAttribute(attribute);
    if (from === null || from === undefined) {
      continue;
    }
    const to = end?.closest(`[${attribute}]`)?.getAttribute(attribute) ?? from;
    const first = Number(from) + 1;
    const last = Number(to) + 1;
    return first === last
      ? `${noun} ${first}`
      : `${noun}s ${Math.min(first, last)}-${Math.max(first, last)}`;
  }
  return;
}
