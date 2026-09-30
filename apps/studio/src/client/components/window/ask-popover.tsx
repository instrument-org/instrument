import { InstrumentGlyph } from "@/client/components/wordmark";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  type ReferenceElement,
  shift,
} from "@floating-ui/dom";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The small card an ask is written in: the Instrument mark, where in the file
 * it points, and one line for what should change. Enter keeps it, Escape or a
 * press anywhere else lets it go.
 */
export function AskPopover({
  initial = "",
  onCancel,
  onRemove,
  onSubmit,
  reference,
  submitLabel = "Add",
  target,
}: {
  initial?: string;
  onCancel: () => void;
  /** Offered for an ask already staged, to take it back out. */
  onRemove?: () => void;
  onSubmit: (instruction: string) => void;
  reference: ReferenceElement;
  submitLabel?: string;
  /** Where in the file the ask points, as a reader says it. */
  target: string;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  // The field takes the caret once the card is placed and visible, since
  // a hidden element cannot hold focus.
  const floating = useFloatingCard<HTMLFormElement>(reference, onCancel, () => {
    field.current?.focus({ preventScroll: true });
  });

  return createPortal(
    <form
      className="invisible fixed top-0 left-0 z-50 w-80 rounded-xl bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-border/60"
      data-ask-popover
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value.trim());
      }}
      ref={floating}
    >
      <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs">
        <InstrumentGlyph
          className="size-3.5 shrink-0 text-brand-600 dark:text-brand-400"
          size={14}
        />
        <span className="font-medium text-foreground">Ask</span>
        <span className="min-w-0 truncate text-muted-foreground">{target}</span>
      </div>
      <input
        aria-label="What should change?"
        className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onChange={(event) => {
          setValue(event.target.value);
        }}
        placeholder="What should change?"
        ref={field}
        value={value}
      />
      <div className="flex items-center gap-1 pt-2 pl-1">
        <span className="mr-auto text-[11px] text-muted-foreground">
          <kbd className="font-sans">↵</kbd> to {submitLabel.toLowerCase()}
        </span>
        {onRemove && (
          <button
            className="h-7 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onRemove}
            type="button"
          >
            Remove
          </button>
        )}
        <button
          className="h-7 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="h-7 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          type="submit"
        >
          {submitLabel}
        </button>
      </div>
    </form>,
    document.body,
  );
}

/**
 * A card standing beside its reference and following it as the document
 * scrolls, hidden until placed. A press anywhere but the card, or Escape
 * inside it, lets it go, the way a menu goes; `onPlaced` runs once it first
 * shows.
 */
function useFloatingCard<T extends HTMLElement>(
  reference: ReferenceElement,
  onDismiss: () => void,
  onPlaced?: () => void,
) {
  const floating = useRef<T>(null);
  const dismiss = useEffectEvent(onDismiss);
  const placed = useEffectEvent(() => {
    onPlaced?.();
  });
  useEffect(() => {
    const element = floating.current;
    if (!element) {
      return;
    }
    let isPlaced = false;
    const place = () => {
      void computePosition(reference, element, {
        middleware: [offset(8), flip(), shift({ padding: 8 })],
        placement: "bottom-start",
        strategy: "fixed",
      }).then(({ x, y }) => {
        element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        element.style.visibility = "visible";
        if (!isPlaced) {
          isPlaced = true;
          placed();
        }
      });
    };
    const stop = autoUpdate(reference, element, place, {
      animationFrame: reference instanceof Range,
    });
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        (!element.contains(target) &&
          !(reference instanceof Element && reference.contains(target)))
      ) {
        dismiss();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    element.addEventListener("keydown", onKey);
    return () => {
      stop();
      document.removeEventListener("pointerdown", onDown, true);
      element.removeEventListener("keydown", onKey);
    };
  }, [reference]);
  return floating;
}
