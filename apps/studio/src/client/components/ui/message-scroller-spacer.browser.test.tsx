// The room the scroller leaves under a sent message is a spacer it trims as
// the reader scrolls. Measured, since jsdom has no layout.
import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./message-scroller";

let send = () => {};

/** A short chat under a UI zoom, so the rows end off the pixel grid. */
function Harness({ zoom }: { zoom: number }) {
  const [sent, setSent] = useState(false);
  send = () => {
    setSent(true);
  };
  return (
    <MessageScrollerProvider autoScroll={false} defaultScrollPosition="end">
      <div style={{ zoom }}>
        <MessageScroller>
          <MessageScrollerViewport style={{ height: 300 }}>
            <MessageScrollerContent className="gap-4 p-4 pb-8">
              {Array.from({ length: 4 }, (_, index) => (
                <MessageScrollerItem
                  key={index}
                  messageId={`row-${index}`}
                  style={{ height: 120.4 }}
                />
              ))}
              {sent ? (
                <MessageScrollerItem
                  messageId="sent"
                  scrollAnchor
                  style={{ height: 40.3 }}
                />
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </div>
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

it.each([1, 0.9, 1.1, 1.25])(
  "keeps the room under a sent message from growing as the reader wheels past the end at zoom %s",
  async (zoom) => {
    await renderInBrowser(<Harness zoom={zoom} />);
    send();
    const element = viewport();
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLElement>("[data-message-scroller-spacer]")
          ?.hidden,
      ).toBe(false);
    });
    const start = element.scrollHeight;
    for (let step = 0; step < 20; step++) {
      await userEvent.wheel(element, { delta: { y: 7 } });
    }
    expect(element.scrollHeight).toBeLessThanOrEqual(start);
  },
);
