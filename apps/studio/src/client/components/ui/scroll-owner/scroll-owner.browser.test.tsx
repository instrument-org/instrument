// The scroll owner in a real browser: where it puts a message just sent, how
// it follows a reply that outgrows the room under it, and what the reader's
// own scrolling does. Measured, since jsdom has no layout.
import { renderInBrowser } from "@/tests/render-browser";
import { noop } from "radashi";
import { Fragment, type RefObject, useLayoutEffect, useState } from "react";
import { expect, it, vi } from "vitest";

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "../message-scroller";

const PEEK = 80;
const PADDING = 16;

let send: (options?: { armed: boolean }) => void = noop;
let grow: (by?: number) => void = noop;

function Arm({ armRef }: { armRef: RefObject<() => void> }) {
  const { armSlide } = useMessageScroller();
  useLayoutEffect(() => {
    armRef.current = armSlide;
  }, [armRef, armSlide]);
  return null;
}

const armRef: RefObject<() => void> = { current: noop };

function Harness() {
  const [sent, setSent] = useState(2);
  const [reply, setReply] = useState(40);
  send = ({ armed } = { armed: true }) => {
    if (armed) {
      armRef.current();
    }
    setSent((count) => count + 1);
  };
  grow = (by = 30) => {
    setReply((height) => height + by);
  };
  return (
    <MessageScrollerProvider autoScroll scrollPreviousItemPeek={PEEK}>
      <MessageScroller>
        <MessageScrollerViewport style={{ height: 400 }}>
          <MessageScrollerContent
            data-content
            style={{
              display: "flex",
              flexDirection: "column",
              padding: PADDING,
            }}
          >
            {Array.from({ length: sent }, (_, index) => (
              <Fragment key={index}>
                <MessageScrollerItem
                  data-sent
                  scrollAnchor
                  style={{ height: 40 }}
                />
                <MessageScrollerItem
                  style={{ height: index === sent - 1 ? reply : 600 }}
                />
              </Fragment>
            ))}
          </MessageScrollerContent>
          <Arm armRef={armRef} />
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

function sentTop() {
  const sent = document.querySelectorAll("[data-sent]");
  return (
    (sent[sent.length - 1]?.getBoundingClientRect().top ?? 0) -
    viewport().getBoundingClientRect().top
  );
}

const isSliding = () =>
  (document.querySelector("[data-content]")?.getAnimations().length ?? 0) > 0;

/** Every frame's painted place until `ms` has passed, with `at` run on the way. */
async function frames(ms: number, at: Record<number, () => void> = {}) {
  const seen: { scrollTop: number; top: number }[] = [];
  const waiting = new Map(Object.entries(at));
  const start = performance.now();
  while (performance.now() - start < ms) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = () => {
          seen.push({ scrollTop: viewport().scrollTop, top: sentTop() });
          resolve();
        };
        port2.postMessage(0);
      });
    });
    for (const [when, run] of waiting) {
      if (performance.now() - start >= Number(when)) {
        waiting.delete(when);
        run();
      }
    }
  }
  return seen;
}

it("holds the message's place while the reply grows under a slide", async () => {
  await renderInBrowser(<Harness />);
  await frames(100);
  send();
  await vi.waitFor(() => {
    expect(isSliding()).toBe(true);
  });
  const seen = await frames(500, { 60: grow, 120: grow, 180: grow });
  // Moving only up, with no step from the scroller's own moves, to where it rests.
  const tops = seen.map(({ top }) => top);
  for (const [index, top] of tops.entries()) {
    expect(top).toBeLessThanOrEqual((tops[index - 1] ?? top) + 0.5);
  }
  expect(tops.at(-1)).toBeCloseTo(PADDING + PEEK, 0);
  expect(new Set(seen.map(({ scrollTop }) => scrollTop)).size).toBe(1);
  expect(isSliding()).toBe(false);
});

it("jumps when nothing armed the slide", async () => {
  await renderInBrowser(<Harness />);
  await frames(100);
  // The way a message from another computer, or a retry, arrives.
  send({ armed: false });
  const seen = await frames(100);
  expect(seen.at(0)?.top).toBeCloseTo(PADDING + PEEK, 0);
  expect(isSliding()).toBe(false);
});

it("stops where it is when the reader scrolls, and is not pulled back", async () => {
  await renderInBrowser(<Harness />);
  await frames(100);
  send();
  await vi.waitFor(() => {
    expect(isSliding()).toBe(true);
  });
  await frames(40);
  const before = sentTop();
  expect(before).toBeGreaterThan(PADDING + PEEK + 20);
  viewport().dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  expect(isSliding()).toBe(false);
  expect(sentTop()).toBeCloseTo(before, 0);
  grow();
  const seen = await frames(120);
  expect(seen.at(-1)?.top).toBeCloseTo(before, 0);
});

/** How far the content ends below the viewport's bottom edge. */
function below() {
  const element = viewport();
  const rows = document.querySelectorAll("[data-message-scroller-item]");
  const last = rows[rows.length - 1];
  return (
    (last?.getBoundingClientRect().bottom ?? 0) +
    PADDING -
    element.getBoundingClientRect().bottom
  );
}

it("follows the reply's end once it outgrows the room under the message", async () => {
  await renderInBrowser(<Harness />);
  await frames(100);
  send({ armed: false });
  await frames(50);
  // Taller than the room left under the message.
  const seen = await frames(400, {
    0: () => {
      grow(200);
    },
    80: () => {
      grow(200);
    },
    160: () => {
      grow(200);
    },
  });
  expect(seen.at(-1)?.top).toBeLessThan(PADDING + PEEK - 100);
  expect(below()).toBeCloseTo(0, 0);
});

it("leaves the reader where they scrolled to, and follows again once they scroll back", async () => {
  await renderInBrowser(<Harness />);
  await frames(100);
  send({ armed: false });
  await frames(50);
  grow(800);
  await frames(50);
  expect(below()).toBeCloseTo(0, 0);
  const element = viewport();
  element.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  element.scrollTop -= 200;
  await frames(50);
  const kept = element.scrollTop;
  grow(300);
  await frames(50);
  expect(element.scrollTop).toBeCloseTo(kept, 0);
  element.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  element.scrollTop = element.scrollHeight;
  await frames(50);
  grow(300);
  await frames(50);
  expect(below()).toBeCloseTo(0, 0);
});

it.each([
  ["down at the end", { deltaY: 40 }],
  ["sideways", { deltaX: 40, deltaY: 2 }],
])(
  "keeps following through a wheel %s, which cannot move the transcript",
  async (_, wheel) => {
    await renderInBrowser(<Harness />);
    await frames(100);
    send({ armed: false });
    await frames(50);
    grow(800);
    await frames(50);
    expect(below()).toBeCloseTo(0, 0);
    viewport().dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, ...wheel }),
    );
    grow(300);
    await frames(50);
    expect(below()).toBeCloseTo(0, 0);
  },
);

it("keeps following when the content gets shorter for a moment", async () => {
  await renderInBrowser(<Harness />);
  await frames(100);
  send({ armed: false });
  await frames(50);
  grow(800);
  await frames(50);
  // A row closing lowers the scroll position with no one scrolling.
  grow(-300);
  await frames(50);
  grow(500);
  await frames(50);
  expect(below()).toBeCloseTo(0, 0);
});

let load: () => void = noop;

/** A chat opened cold: a spinner first, then one message and a long reply, taken to the end as they land. */
function ColdOpen() {
  const [isLoaded, setIsLoaded] = useState(false);
  load = () => {
    setIsLoaded(true);
  };
  return (
    <MessageScrollerProvider autoScroll scrollPreviousItemPeek={PEEK}>
      <MessageScroller>
        <MessageScrollerViewport style={{ height: 400 }}>
          <MessageScrollerContent
            style={{
              display: "flex",
              flexDirection: "column",
              padding: PADDING,
            }}
          >
            {isLoaded ? (
              <>
                <MessageScrollerItem
                  data-sent
                  scrollAnchor
                  style={{ height: 40 }}
                />
                <MessageScrollerItem style={{ height: 900 }} />
              </>
            ) : (
              <div style={{ height: 20 }} />
            )}
          </MessageScrollerContent>
          <TakeEnd signal={isLoaded ? "loaded" : "loading"} />
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function TakeEnd({ signal }: { signal: string }) {
  const { scrollToEnd } = useMessageScroller();
  useLayoutEffect(() => {
    scrollToEnd();
  }, [scrollToEnd, signal]);
  return null;
}

it("opens a chat with one message at its end once its messages land after a spinner", async () => {
  await renderInBrowser(<ColdOpen />);
  await frames(100);
  load();
  await frames(100);
  expect(below()).toBeCloseTo(0, 0);
});
