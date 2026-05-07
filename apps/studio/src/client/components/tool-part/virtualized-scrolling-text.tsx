import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";

export function VirtualizedScrollingText({
  autoScrollToBottom = false,
  content,
  highlightedLines,
}: {
  autoScrollToBottom?: boolean;
  content: string;
  highlightedLines?: string[];
}) {
  "use no memo";
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fadeTopRef = useRef<HTMLDivElement>(null);
  const fadeBottomRef = useRef<HTMLDivElement>(null);

  // Remove trailing empty line when not auto-scrolling
  const cleanedContent =
    !autoScrollToBottom && content.endsWith("\n")
      ? content.slice(0, -1)
      : content;
  const lines = cleanedContent.split("\n");

  const displayLines =
    highlightedLines && highlightedLines.length > 0 ? highlightedLines : lines;

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: displayLines.length,
    estimateSize: () => 22,
    getScrollElement: () => scrollContainerRef.current,
    overscan: 5,
  });

  // Directly toggle fade visibility via DOM refs -- no re-render on scroll
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }

    const update = () => {
      const canScrollUp = el.scrollTop > 0;
      const canScrollDown =
        el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      if (fadeTopRef.current) {
        fadeTopRef.current.style.display = canScrollUp ? "block" : "none";
      }
      if (fadeBottomRef.current) {
        fadeBottomRef.current.style.display = canScrollDown ? "block" : "none";
      }
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const totalSize = virtualizer.getTotalSize();

  // Stick to bottom when autoScrollToBottom is true
  useEffect(() => {
    if (!autoScrollToBottom || !scrollContainerRef.current) {
      return;
    }

    const lastItem = virtualizer.getVirtualItems().at(-1);

    if (lastItem) {
      virtualizer.scrollToIndex(displayLines.length - 1, {
        align: "end",
        behavior: "auto",
      });
    }
  }, [displayLines.length, autoScrollToBottom, virtualizer]);

  // Scroll to top when autoScrollToBottom becomes false
  useEffect(() => {
    if (autoScrollToBottom || !scrollContainerRef.current) {
      return;
    }

    virtualizer.scrollToIndex(0, {
      align: "start",
      behavior: "auto",
    });
  }, [autoScrollToBottom, virtualizer]);

  if (!cleanedContent) {
    return null;
  }

  const virtualItems = virtualizer.getVirtualItems();
  const isHighlighted = highlightedLines && highlightedLines.length > 0;

  const contentInner = (
    <div
      className="font-mono text-sm whitespace-pre text-foreground/90"
      style={{ height: `${totalSize}px`, position: "relative", width: "100%" }}
    >
      {virtualItems.map((virtualItem) => {
        const line = displayLines[virtualItem.index];

        return (
          <div
            key={virtualItem.key}
            style={{
              height: `${virtualItem.size}px`,
              left: 0,
              position: "absolute",
              top: 0,
              transform: `translateY(${virtualItem.start}px)`,
              width: "100%",
            }}
          >
            {isHighlighted ? (
              <div dangerouslySetInnerHTML={{ __html: line || "" }} />
            ) : (
              <pre className="font-mono text-sm leading-relaxed">{line}</pre>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="relative">
      <div
        className={
          autoScrollToBottom
            ? "pointer-events-none overflow-hidden"
            : "overflow-auto scrollbar-color scrollbar-thin"
        }
        ref={scrollContainerRef}
        // 7.5 lines × (14px × 1.625 leading) ≈ 170px; cuts off mid-line to imply scrolling
        style={{ maxHeight: "170px" }}
      >
        {contentInner}
      </div>
      <div
        className="pointer-events-none absolute top-0 right-0 left-0 z-10 h-6 bg-linear-to-b from-card to-transparent"
        ref={fadeTopRef}
        style={{ display: "none" }}
      />
      <div
        className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 h-6 bg-linear-to-t from-card to-transparent"
        ref={fadeBottomRef}
        style={{ display: "none" }}
      />
    </div>
  );
}
