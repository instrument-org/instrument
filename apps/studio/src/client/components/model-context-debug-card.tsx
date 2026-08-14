import { cn } from "@/client/lib/utils";
import { systemNoteBody } from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { debounce } from "radashi";
import { useEffect, useRef, useState } from "react";

import { DevModeCard, DevModeCardHeader } from "./dev-mode-card";

// Three and a half lines of the note's mono text (`text-xs` sets a 16px line
// box). Enough to tell one note from another while scanning a turn, short
// enough that a long one doesn't bury the work around it, and the half line is
// what the fade below has to dissolve so all three read at full contrast. One
// constant rather than a class and a number, because the height the note clamps
// at and the height the overflow check measures against have to be the same: a
// note taller than one and shorter than the other gets a fade and an expander
// over text that was never cut off.
const COLLAPSED_MAX_HEIGHT_PX = 56;

export function ModelContextDebugCard({
  className,
  text,
}: {
  className?: string;
  text: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLPreElement>(null);

  const body = systemNoteBody(text);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    // `scrollHeight` is the full content height under either clamp, so this
    // answers the same question expanded or collapsed without borrowing the
    // element's styles to measure through.
    const checkOverflow = () => {
      setIsOverflowing(element.scrollHeight > COLLAPSED_MAX_HEIGHT_PX);
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(
      debounce({ delay: 100 }, checkOverflow),
    );
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [body]);

  const toggle = () => {
    setIsExpanded((expanded) => !expanded);
  };

  return (
    <DevModeCard className={cn("relative", className)}>
      <button
        className="block w-full cursor-default text-left"
        disabled={!isOverflowing}
        onClick={toggle}
        type="button"
      >
        <DevModeCardHeader
          action={
            isOverflowing ? (
              <CaretRightIcon
                className={cn(
                  "size-3 text-muted-foreground transition-transform duration-200",
                  isExpanded && "rotate-90",
                )}
              />
            ) : undefined
          }
          caption="Injected into prompt."
        />
      </button>

      <pre
        className={cn(
          "mt-1 font-mono text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground",
          isExpanded
            ? "max-h-64 overflow-y-auto scroll-fade-y"
            : "overflow-hidden",
          // Dissolve the half line the clamp leaves showing, so it reads as
          // "more below" rather than a hard cutoff. scroll-fade-y is
          // scroll-timeline driven and does nothing on a static clamp, so the
          // bottom mask is spelled out inline.
          !isExpanded &&
            isOverflowing &&
            "[mask-image:linear-gradient(to_bottom,black_calc(100%_-_0.5rem),transparent)]",
        )}
        data-slot="model-context-debug-card-note"
        ref={contentRef}
        style={isExpanded ? undefined : { maxHeight: COLLAPSED_MAX_HEIGHT_PX }}
      >
        {body}
      </pre>

      {/* Collapsed, the clipped text is the obvious thing to click, so the whole
          card is the target. Expanded, it isn't there, and the note can be
          selected and copied. */}
      {isOverflowing && !isExpanded && (
        <button
          aria-label="Show the full note"
          className="absolute inset-0 cursor-default"
          data-slot="model-context-debug-card-expand"
          onClick={toggle}
          type="button"
        />
      )}
    </DevModeCard>
  );
}
