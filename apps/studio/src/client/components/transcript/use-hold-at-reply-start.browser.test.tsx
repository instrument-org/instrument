import { renderInBrowser } from "@/tests/render-browser";
import { noop } from "radashi";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { expect, it, vi } from "vitest";

import {
  TranscriptScrollContext,
  useReleaseAutoScroll,
} from "../transcript-scroll-context";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "../ui/message-scroller";
import { CardPresence } from "./card-motion";
import { useHoldAtReplyStart } from "./use-hold-at-reply-start";

type Content = {
  reply: number;
  preview: boolean;
  question: boolean;
  newMessage: boolean;
};

let update: (patch: Partial<Content>) => void = noop;
let follow: () => void = noop;
let arrivals = 0;

function ReadingHold({
  children,
  contentRef,
}: {
  children: ReactNode;
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const { releaseAutoScroll, scrollToEnd } = useMessageScroller();
  follow = scrollToEnd;
  useHoldAtReplyStart({
    contentRef,
    isFollowing: true,
    onArrivedBelow: () => {
      arrivals += 1;
    },
    release: releaseAutoScroll,
  });
  return (
    <TranscriptScrollContext value={releaseAutoScroll}>
      {children}
    </TranscriptScrollContext>
  );
}

function ExpandableRow() {
  const release = useReleaseAutoScroll();
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => {
        release();
        setExpanded(true);
      }}
      style={{ height: expanded ? 300 : 30 }}
      type="button"
    >
      Open details
    </button>
  );
}

function Harness({ height = 350, initialReply = 0 }) {
  arrivals = 0;
  const contentRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<Content>({
    reply: initialReply,
    preview: false,
    question: false,
    newMessage: false,
  });
  update = (patch) => {
    setContent((current) => ({ ...current, ...patch }));
  };
  return (
    <div style={{ height, width: 440 }}>
      <MessageScrollerProvider
        autoScroll
        defaultScrollPosition="end"
        scrollPreviousItemPeek={80}
      >
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent ref={contentRef} style={{ padding: 16 }}>
              <ReadingHold contentRef={contentRef}>
                <MessageScrollerItem style={{ height: 600 }}>
                  Earlier work
                </MessageScrollerItem>
                <MessageScrollerItem scrollAnchor style={{ height: 50 }}>
                  The person's message
                </MessageScrollerItem>
                <MessageScrollerItem className="flex flex-col gap-2">
                  <ExpandableRow />
                  {content.reply > 0 && (
                    <div
                      data-reply-row="reply"
                      data-reply-tail={
                        (!content.preview &&
                          !content.question &&
                          !content.newMessage) ||
                        undefined
                      }
                      style={{ height: content.reply }}
                    >
                      Assistant words
                    </div>
                  )}
                  {content.preview && (
                    <CardPresence opens>
                      <div data-preview style={{ height: 300 }}>
                        Task preview
                      </div>
                    </CardPresence>
                  )}
                  {content.question && (
                    <div data-question style={{ height: 240 }}>
                      A question and its choices
                    </div>
                  )}
                </MessageScrollerItem>
                {content.newMessage && (
                  <MessageScrollerItem
                    data-new-message
                    scrollAnchor
                    style={{ height: 50 }}
                  >
                    The next message
                  </MessageScrollerItem>
                )}
              </ReadingHold>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}

function viewport() {
  const element = document.querySelector<HTMLElement>(
    '[data-slot="message-scroller-viewport"]',
  );
  if (!element) throw new Error("No transcript viewport");
  return element;
}

function bounds(selector: string) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No ${selector}`);
  const box = element.getBoundingClientRect();
  const top = viewport().getBoundingClientRect().top;
  return { top: box.top - top, bottom: box.bottom - top };
}

async function settle() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function holdLongReply() {
  update({ reply: 40 });
  await settle();
  update({ reply: 650 });
  await vi.waitFor(() => {
    expect(bounds("[data-reply-row]").top).toBeCloseTo(40, 0);
  });
}

it.each([350, 500])(
  "follows a task preview opening below introductory text in a %ipx viewport",
  async (height) => {
    await renderInBrowser(<Harness height={height} />);
    update({ reply: 40 });
    await settle();
    update({ preview: true });
    await vi.waitFor(() => {
      expect(bounds("[data-preview]").bottom).toBeLessThanOrEqual(height - 15);
    });
    await expect
      .poll(
        () =>
          document.querySelector("[data-preview]")?.parentElement?.offsetHeight,
      )
      .toBe(300);
    expect(bounds("[data-preview]").bottom).toBeLessThanOrEqual(height - 15);
  },
);

it("stays at a held reply and says a question arrived under it", async () => {
  await renderInBrowser(<Harness />);
  await holdLongReply();
  const before = viewport().scrollTop;
  update({ question: true });
  await settle();
  await settle();
  expect(viewport().scrollTop).toBeCloseTo(before, 0);
  expect(bounds("[data-reply-row]").top).toBeCloseTo(40, 0);
  expect(arrivals).toBe(1);
});

it("keeps a long final reply at its start as more words arrive", async () => {
  await renderInBrowser(<Harness />);
  await holdLongReply();
  update({ reply: 850 });
  await settle();
  expect(bounds("[data-reply-row]").top).toBeCloseTo(40, 0);
  expect(arrivals).toBe(0);
});

it("opens an existing long reply at its end", async () => {
  await renderInBrowser(<Harness initialReply={650} />);
  await vi.waitFor(() => {
    expect(bounds("[data-reply-row]").bottom).toBeLessThanOrEqual(334);
  });
});

it("leaves the reader where they scrolled a held reply and still says what arrived", async () => {
  await renderInBrowser(<Harness />);
  await holdLongReply();
  viewport().dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  viewport().scrollTop += 120;
  await settle();
  const before = viewport().scrollTop;
  update({ question: true });
  await settle();
  await settle();
  expect(viewport().scrollTop).toBeCloseTo(before, 0);
  expect(arrivals).toBe(1);
});

it("does not move after the reader opens a row", async () => {
  const screen = await renderInBrowser(<Harness />);
  await holdLongReply();
  await screen.getByRole("button", { name: "Open details" }).click();
  await settle();
  const before = viewport().scrollTop;
  update({ question: true });
  await settle();
  expect(viewport().scrollTop).toBeCloseTo(before, 0);
});

it("keeps a new message at its send anchor after a reading hold", async () => {
  await renderInBrowser(<Harness />);
  await holdLongReply();
  update({ newMessage: true });
  await vi.waitFor(() => {
    expect(bounds("[data-new-message]").top).toBeCloseTo(96, 0);
  });
  expect(arrivals).toBe(0);
});

it("follows again after the reader returns to the end", async () => {
  await renderInBrowser(<Harness />);
  await holdLongReply();
  viewport().dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  follow();
  update({ question: true });
  await vi.waitFor(() => {
    expect(bounds("[data-question]").bottom).toBeLessThanOrEqual(334);
  });
});
