// A thread at rest has nothing following its end but the bridge, so what the
// bridge does while a long transcript lays out is the whole of whether the
// reader arrives at the bottom. Measured, since jsdom has no layout.
import { renderInBrowser } from "@/tests/render-browser";
import { useEffect, useRef, useState } from "react";
import { expect, it, vi } from "vitest";

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../ui/message-scroller";
import { ScrollToEndBridge } from "./scroll-to-end-bridge";

const VIEWPORT_HEIGHT = 200;
const BLOCK_HEIGHT = 120;

/**
 * A transcript that lays out late: a few blocks at once, and more arriving
 * on a timer after the bridge's first pass, the way images and cards do.
 */
function Harness({ arrivals }: { arrivals: number[] }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState(3);
  useEffect(() => {
    const timers = arrivals.map((delay) =>
      setTimeout(() => {
        setBlocks((count) => count + 1);
      }, delay),
    );
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [arrivals]);
  return (
    <MessageScrollerProvider autoScroll={false} defaultScrollPosition="end">
      <ScrollToEndBridge contentRef={contentRef} signal="loaded" />
      <MessageScroller>
        <MessageScrollerViewport style={{ height: VIEWPORT_HEIGHT }}>
          <MessageScrollerContent ref={contentRef}>
            {Array.from({ length: blocks }, (_, index) => (
              <div data-block key={index} style={{ height: BLOCK_HEIGHT }}>
                block {index}
              </div>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function viewport() {
  const element = document.querySelector<HTMLElement>(
    "[data-slot=message-scroller-viewport]",
  );
  if (!element) {
    throw new Error("no viewport");
  }
  return element;
}

function blockCount() {
  return document.querySelectorAll("[data-block]").length;
}

function distanceFromEnd() {
  const element = viewport();
  return Math.round(
    element.scrollHeight - element.clientHeight - element.scrollTop,
  );
}

it("reaches the end of a transcript that keeps laying out after it arrived", async () => {
  await renderInBrowser(<Harness arrivals={[80, 160, 240]} />);
  await vi.waitFor(
    () => {
      expect(blockCount()).toBe(6);
      expect(distanceFromEnd()).toBe(0);
    },
    { timeout: 2000 },
  );
});

it("leaves the transcript where the reader put it once they took the wheel", async () => {
  await renderInBrowser(<Harness arrivals={[80, 400]} />);
  await vi.waitFor(() => {
    expect(blockCount()).toBe(4);
    expect(distanceFromEnd()).toBe(0);
  });
  viewport().dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, deltaY: -40 }),
  );
  viewport().scrollTop = 0;
  await vi.waitFor(() => {
    expect(blockCount()).toBe(5);
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(viewport().scrollTop).toBe(0);
});
