// Where a reply landing at the live end leaves the reader, against the real
// scroller following that end. Measured, since jsdom has no layout.
import { renderInBrowser } from "@/tests/render-browser";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { expect, it, vi } from "vitest";

import {
  scrollToReplyStart,
  TRANSCRIPT_PREVIOUS_TURN_PEEK,
  TranscriptScrollContext,
  useReleaseAutoScroll,
} from "./transcript-scroll-context";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "./ui/message-scroller";

const VIEWPORT_HEIGHT = 300;

/** A reply as the bubbles bring one in: mid-arrival, scaled and lowered. */
function Reply({ height }: { height: number }) {
  const releaseAutoScroll = useReleaseAutoScroll();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current && scrollToReplyStart(ref.current)) {
      releaseAutoScroll();
    }
  }, [releaseAutoScroll]);
  return (
    <MessageScrollerItem>
      <div
        data-reply
        ref={ref}
        style={{ height, transform: "translateY(8px) scale(0.95)" }}
      />
    </MessageScrollerItem>
  );
}

function Release({ children }: { children: ReactNode }) {
  const { releaseAutoScroll } = useMessageScroller();
  return (
    <TranscriptScrollContext value={releaseAutoScroll}>
      {children}
    </TranscriptScrollContext>
  );
}

function Harness({ replies }: { replies: number[] }) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport style={{ height: VIEWPORT_HEIGHT }}>
          <MessageScrollerContent>
            <Release>
              {[200, 200, 200].map((height, index) => (
                <MessageScrollerItem key={`earlier-${index}`}>
                  <div style={{ height }} />
                </MessageScrollerItem>
              ))}
              {replies.map((height, index) => (
                <Reply height={height} key={index} />
              ))}
            </Release>
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

function distanceFromEnd() {
  const element = viewport();
  return Math.round(
    element.scrollHeight - element.clientHeight - element.scrollTop,
  );
}

/** The newest reply's top, from the viewport's top, as it settles. */
function newestReplyTop() {
  const replies = document.querySelectorAll<HTMLElement>("[data-reply]");
  const reply = replies[replies.length - 1];
  if (!reply) {
    throw new Error("no reply");
  }
  return reply.offsetTop - viewport().offsetTop - viewport().scrollTop;
}

async function settle() {
  for (let frame = 0; frame < 6; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

it("opens a reply taller than the pane at its first line", async () => {
  const screen = await renderInBrowser(<Harness replies={[]} />);
  await vi.waitFor(() => {
    expect(distanceFromEnd()).toBe(0);
  });
  await screen.rerender(<Harness replies={[900]} />);
  await settle();
  expect(Math.round(newestReplyTop())).toBe(TRANSCRIPT_PREVIOUS_TURN_PEEK);
});

it("follows the end for a reply that fits", async () => {
  const screen = await renderInBrowser(<Harness replies={[]} />);
  await vi.waitFor(() => {
    expect(distanceFromEnd()).toBe(0);
  });
  await screen.rerender(<Harness replies={[120]} />);
  await settle();
  expect(distanceFromEnd()).toBe(0);
});

it("leaves a reader who scrolled back where they are", async () => {
  const screen = await renderInBrowser(<Harness replies={[]} />);
  await vi.waitFor(() => {
    expect(distanceFromEnd()).toBe(0);
  });
  viewport().dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  viewport().scrollTop = 100;
  await settle();
  await screen.rerender(<Harness replies={[900]} />);
  await settle();
  expect(viewport().scrollTop).toBe(100);
});

it("follows the end again once the reader scrolls down to it", async () => {
  const screen = await renderInBrowser(<Harness replies={[]} />);
  await vi.waitFor(() => {
    expect(distanceFromEnd()).toBe(0);
  });
  await screen.rerender(<Harness replies={[900]} />);
  await settle();
  viewport().dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  viewport().scrollTop = viewport().scrollHeight;
  await settle();
  await screen.rerender(<Harness replies={[900, 120]} />);
  await settle();
  expect(distanceFromEnd()).toBe(0);
});
