// What lands on a turn far from view, drawn as a box: a quote shown from the
// box and a link to a heading in an earlier reply each draw the turn and
// bring their words into view. Measured, since jsdom has no layout or
// observers.
import { useHashLinkScroll } from "@/client/hooks/use-hash-link-scroll";
import { renderInBrowser } from "@/tests/render-browser";
import { createRef, useRef } from "react";
import { expect, it } from "vitest";

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../ui/message-scroller";
import { QuoteSelection, type QuoteSelectionRef } from "./quote-selection";

const TURNS = 30;

function HeadingLink() {
  const onClick = useHashLinkScroll();
  return (
    <a href="#soup-first" onClick={onClick}>
      back to the soup
    </a>
  );
}

function Turns({ quote }: { quote: React.Ref<QuoteSelectionRef> }) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller style={{ height: 600, width: 640 }}>
        <MessageScrollerViewport>
          <MessageScrollerContent ref={contentRef}>
            {Array.from({ length: TURNS }, (_, index) => {
              const id = `turn-${index.toString()}`;
              return (
                <MessageScrollerItem
                  key={id}
                  keepDrawn={index === TURNS - 1}
                  messageId={id}
                  turnId={id}
                >
                  {index === 1 && (
                    // The person's own words, which a quote is never of.
                    <p>Simmer the onions slowly?</p>
                  )}
                  <div data-reply-row={id} style={{ minHeight: 400 }}>
                    {index === 0 ? (
                      <>
                        <h2 id="soup-first">Soup first</h2>
                        <p>Simmer the onions slowly until golden.</p>
                      </>
                    ) : (
                      <p>Turn {index}</p>
                    )}
                    {index === TURNS - 1 && <HeadingLink />}
                  </div>
                </MessageScrollerItem>
              );
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
      <QuoteSelection
        onQuote={() => undefined}
        quoted="[]"
        ref={quote}
        rootRef={contentRef}
      />
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

const isFirstBoxed = () =>
  document
    .querySelector('[data-turn-id="turn-0"]')
    ?.hasAttribute("data-placeholder");

/** Whether `element` is drawn and within the viewport. */
function isInView(element: Element | null) {
  if (!element) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const view = viewport().getBoundingClientRect();
  return rect.height > 0 && rect.top >= view.top && rect.bottom <= view.bottom;
}

it("draws a boxed turn to show the words a quote names", async () => {
  const quote = createRef<QuoteSelectionRef>();
  await renderInBrowser(<Turns quote={quote} />);
  await expect.poll(isFirstBoxed).toBe(true);

  await quote.current?.show("Simmer the onions\nslowly");

  expect(isFirstBoxed()).toBe(false);
  await expect
    .poll(() =>
      isInView(
        [...document.querySelectorAll("p")].find((p) =>
          p.textContent.startsWith("Simmer"),
        ) ?? null,
      ),
    )
    .toBe(true);
});

it("draws a boxed turn to reach the heading a link names", async () => {
  await renderInBrowser(<Turns quote={null} />);
  await expect.poll(isFirstBoxed).toBe(true);
  expect(document.querySelector("#soup-first")).toBeNull();

  document.querySelector<HTMLAnchorElement>('a[href="#soup-first"]')?.click();

  // A smooth scroll the length of the column.
  await expect
    .poll(() => isInView(document.querySelector("#soup-first")), {
      timeout: 5000,
    })
    .toBe(true);
});
