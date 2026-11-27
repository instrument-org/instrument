// What floats over the transcript's foot, the button to the end above all,
// sits in the viewport, so a wheel over it scrolls the transcript. Measured,
// since jsdom has no layout and never scrolls.
import { renderInBrowser } from "@/tests/render-browser";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerFoot,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./message-scroller";

const VIEW = 400;

/** A transcript laid out as the chat lays it out, opened at its start. */
function Harness() {
  return (
    <MessageScrollerProvider defaultScrollPosition="start">
      <MessageScroller style={{ height: VIEW }}>
        <MessageScrollerViewport>
          <MessageScrollerContent className="p-4 pb-8">
            {Array.from({ length: 20 }, (_, index) => (
              <MessageScrollerItem
                key={index}
                messageId={`row-${index}`}
                style={{ height: 100 }}
              >
                {/* Raised as a file card raises its text. */}
                <div className="relative z-10 h-full" data-raised />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
          <MessageScrollerFoot>
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
              <MessageScrollerButton className="pointer-events-auto" />
            </div>
          </MessageScrollerFoot>
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

function button() {
  const element = document.querySelector<HTMLElement>(
    "[data-slot=message-scroller-button]",
  );
  if (!element) {
    throw new Error("no button");
  }
  return element;
}

async function renderShown() {
  await renderInBrowser(<Harness />);
  await vi.waitFor(() => {
    expect(button().dataset.active).toBe("true");
  });
}

it("scrolls the transcript on a wheel over the button", async () => {
  await renderShown();
  expect(viewport().scrollTop).toBe(0);
  await userEvent.wheel(button(), { delta: { y: 300 } });
  await vi.waitFor(() => {
    expect(viewport().scrollTop).toBeGreaterThan(100);
  });
});

it("goes to the end on a click, and hides the button there", async () => {
  await renderShown();
  await userEvent.click(button());
  const element = viewport();
  await vi.waitFor(() => {
    expect(element.scrollTop).toBeGreaterThanOrEqual(
      element.scrollHeight - element.clientHeight - 1,
    );
    expect(button().dataset.active).toBe("false");
  });
});

it("stays at the viewport's foot, over the rows, adding nothing to the scroll height", async () => {
  await renderShown();
  const element = viewport();
  const content = document.querySelector<HTMLElement>(
    "[data-slot=message-scroller-content]",
  );
  expect(element.scrollHeight).toBe(content?.offsetHeight);
  element.scrollTop = 700;
  await new Promise(requestAnimationFrame);
  const pane = element.getBoundingClientRect();
  const rect = button().getBoundingClientRect();
  expect(pane.bottom - rect.bottom).toBeCloseTo(16, 0);
  // A row's raised text is under the button, not over it.
  expect(
    document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    ),
  ).toBe(button());
});
