// What a slide does to the real scroller: its hold on the message reads a
// transform as distance, so only a browser can say the two get along.
import { renderInBrowser } from "@/tests/render-browser";
import { noop } from "radashi";
import { Fragment, type RefObject, useRef, useState } from "react";
import { expect, it, vi } from "vitest";

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "../ui/message-scroller";
import { useSlideToSent } from "./use-slide-to-sent";

const PEEK = 80;
const PADDING = 16;

let send: (options?: { armed: boolean }) => void = noop;
let grow = noop;

function Slide({
  armRef,
  contentRef,
}: {
  armRef: RefObject<() => void>;
  contentRef: RefObject<HTMLElement | null>;
}) {
  const { releaseAutoScroll } = useMessageScroller();
  useSlideToSent({ armRef, contentRef, release: releaseAutoScroll });
  return null;
}

function Harness() {
  const armRef = useRef<() => void>(noop);
  const contentRef = useRef<HTMLDivElement>(null);
  const [sent, setSent] = useState(2);
  const [reply, setReply] = useState(40);
  send = ({ armed } = { armed: true }) => {
    if (armed) {
      armRef.current();
    }
    setSent((count) => count + 1);
  };
  grow = () => {
    setReply((height) => height + 30);
  };
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      scrollPreviousItemPeek={PEEK}
    >
      <MessageScroller>
        <MessageScrollerViewport style={{ height: 400 }}>
          <MessageScrollerContent
            data-content
            ref={contentRef}
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
          <Slide armRef={armRef} contentRef={contentRef} />
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
