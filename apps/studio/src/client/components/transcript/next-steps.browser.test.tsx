// The rows arrive after the reply they follow, when nothing is following the
// transcript, so where the reader ends up is the rows' own doing. Measured,
// since jsdom has no layout.
import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../ui/message-scroller";
import { NextStepRows, NextStepsContext } from "./next-steps";

const LINES = ["Add Help Scout", "Redo it at 25 agents", "Make a summary"];

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

function rows() {
  return document.querySelector("[aria-label='Suggested next messages']");
}

/** A transcript taller than its window, whose rows arrive on a press of "arrive". */
function Harness({
  isBoxEmpty = true,
  onSend = () => undefined,
}: {
  isBoxEmpty?: boolean;
  onSend?: (line: string) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  return (
    <>
      <button
        onClick={() => {
          setLines(LINES);
        }}
        type="button"
      >
        arrive
      </button>
      <MessageScrollerProvider autoScroll={false} defaultScrollPosition="end">
        <MessageScroller>
          <MessageScrollerViewport style={{ height: 200 }}>
            <MessageScrollerContent>
              <MessageScrollerItem className="flex flex-col gap-2">
                <div style={{ height: 600 }}>the reply</div>
                <NextStepsContext value={{ isBoxEmpty, lines, onSend }}>
                  <NextStepRows />
                </NextStepsContext>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </>
  );
}

it("keeps a reader at the end there as the rows arrive", async () => {
  const screen = await renderInBrowser(<Harness />);
  await vi.waitFor(() => {
    expect(distanceFromEnd()).toBe(0);
  });
  await screen.getByRole("button", { name: "arrive" }).click();
  await vi.waitFor(() => {
    expect(rows()).not.toBeNull();
    expect(distanceFromEnd()).toBe(0);
  });
});

it("leaves a reader who scrolled away where they are", async () => {
  const screen = await renderInBrowser(<Harness />);
  await vi.waitFor(() => {
    expect(distanceFromEnd()).toBe(0);
  });
  viewport().scrollTop = 100;
  await screen.getByRole("button", { name: "arrive" }).click();
  await vi.waitFor(() => {
    expect(rows()).not.toBeNull();
  });
  expect(viewport().scrollTop).toBe(100);
  expect(distanceFromEnd()).toBeGreaterThan(0);
});

/**
 * A message just sent, held at the top of the window with room left under it,
 * then a short reply whose rows arrive on a press of "arrive".
 */
function SentHarness() {
  const [sent, setSent] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  return (
    <>
      <button
        onClick={() => {
          setSent(true);
        }}
        type="button"
      >
        send
      </button>
      <button
        onClick={() => {
          setLines(LINES);
        }}
        type="button"
      >
        arrive
      </button>
      <MessageScrollerProvider autoScroll={false} defaultScrollPosition="end">
        <MessageScroller>
          <MessageScrollerViewport style={{ height: 400 }}>
            <MessageScrollerContent>
              <MessageScrollerItem
                messageId="history"
                style={{ height: 800 }}
              />
              {sent ? (
                <MessageScrollerItem
                  data-testid="sent"
                  messageId="sent"
                  scrollAnchor
                  style={{ height: 40 }}
                />
              ) : null}
              {sent ? (
                <MessageScrollerItem
                  className="flex flex-col gap-2"
                  messageId="reply"
                >
                  <div style={{ height: 40 }}>the reply</div>
                  <NextStepsContext
                    value={{ isBoxEmpty: true, lines, onSend: () => undefined }}
                  >
                    <NextStepRows />
                  </NextStepsContext>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </>
  );
}

it("leaves a sent message where it is held when the rows fit in the room under it", async () => {
  const screen = await renderInBrowser(<SentHarness />);
  await screen.getByRole("button", { name: "send" }).click();
  const sentTop = () =>
    Math.round(
      screen.getByTestId("sent").element().getBoundingClientRect().top -
        viewport().getBoundingClientRect().top,
    );
  await vi.waitFor(() => {
    expect(sentTop()).toBeLessThan(100);
  });
  const before = sentTop();
  await screen.getByRole("button", { name: "arrive" }).click();
  await vi.waitFor(() => {
    expect(rows()).not.toBeNull();
  });
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(sentTop()).toBe(before);
});

it("sends the row pressed, and shows the chord on the first while the box is empty", async () => {
  const onSend = vi.fn();
  const screen = await renderInBrowser(<Harness onSend={onSend} />);
  await screen.getByRole("button", { name: "arrive" }).click();
  await expect
    .element(screen.getByRole("button", { name: /Add Help Scout/ }))
    .toMatchTextContent(/Enter|↩|↵/);
  await screen.getByRole("button", { name: "Redo it at 25 agents" }).click();
  expect(onSend).toHaveBeenCalledExactlyOnceWith("Redo it at 25 agents");
});

it("shows no chord once the box has words", async () => {
  const screen = await renderInBrowser(<Harness isBoxEmpty={false} />);
  await screen.getByRole("button", { name: "arrive" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Add Help Scout" }))
    .toHaveTextContent("Add Help Scout");
});
