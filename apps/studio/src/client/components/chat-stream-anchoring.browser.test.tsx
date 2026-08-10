import "@/client/styles/globals.css";
import {
  type SessionMessage,
  StoreId,
  type Task,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ChatStream } from "./chat-stream";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "./ui/message-scroller";
import { TooltipProvider } from "./ui/tooltip";

/**
 * Where an anchored turn comes to rest, and whether it stays there.
 *
 * Every assertion here is a measured position, so jsdom can say nothing about
 * any of it: with no layout engine the transcript is zero tall, the scroller
 * never overflows, and a test passes whether or not the turn moved.
 */

const VIEWPORT_HEIGHT = 320;

const sessionId = StoreId.newSessionId();

const task: Task = {
  createdAt: new Date(0),
  id: TaskIdSchema.parse("quarterly-numbers"),
  title: "Quarterly numbers",
  updatedAt: new Date(0),
};

function message(role: "assistant" | "user", text: string) {
  return {
    id: StoreId.newMessageId(),
    metadata: { createdAt: new Date(0), sessionId },
    parts: [
      {
        metadata: {
          createdAt: new Date(0),
          id: StoreId.newPartId(),
          messageId: StoreId.newMessageId(),
          sessionId,
        },
        state: "done",
        text,
        type: "text",
      },
    ],
    role,
  };
}

/** One finished read, as its own assistant message: a turn is a message a step. */
function readStep(filePath: string) {
  return {
    id: StoreId.newMessageId(),
    metadata: { createdAt: new Date(0), sessionId },
    parts: [
      {
        input: { explanation: `Reading ${filePath}`, filePath },
        metadata: {
          createdAt: new Date(0),
          endedAt: new Date(2),
          id: StoreId.newPartId(),
          messageId: StoreId.newMessageId(),
          sessionId,
          startedAt: new Date(1),
        },
        output: {
          content: "region,revenue",
          displayedLines: 1,
          filePath,
          hasMoreLines: false,
          modifiedAt: 0,
          offset: 1,
          state: "exists",
          totalLines: 1,
          truncatedByBytes: false,
        },
        state: "output-available",
        toolCallId: StoreId.ToolCallSchema.parse(`call-${filePath}`),
        type: "tool-read_file",
      },
    ],
    role: "assistant",
  };
}

// Enough turns above to make the transcript overflow, so the anchor has room to
// move to and the placement is a real measurement rather than a clamp to zero.
const history = Array.from({ length: 6 }, (_, index) => [
  message("user", `Question ${index + 1}`),
  message("assistant", `A paragraph of reply number ${index + 1}.`),
]).flat();

function anchorOffset() {
  const viewport = document.querySelector<HTMLElement>(
    "[data-slot=message-scroller-viewport]",
  );
  const last = [
    ...document.querySelectorAll<HTMLElement>('[data-scroll-anchor="true"]'),
  ].at(-1);

  if (!viewport || !last) {
    throw new Error("no anchored turn in a scroller");
  }

  return Math.round(
    last.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
  );
}

/**
 * The turn as the reader sees it arrive: sent, then answered.
 *
 * Studio removes the standalone wordmark in the same commit that adds the
 * agent's first message, so the scroller's content observer sees one batch with
 * an unchanged child count -- which is the branch this is here to hold.
 */
function Harness({
  isAgentRunning = true,
  steps,
}: {
  isAgentRunning?: boolean;
  steps: unknown[][];
}) {
  const [index, setIndex] = useState(0);

  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <div className="flex flex-col" style={{ width: 640 }}>
          <button
            onClick={() => {
              setIndex((current) => current + 1);
            }}
            type="button"
          >
            step
          </button>
          <MessageScrollerProvider
            autoScroll={isAgentRunning}
            defaultScrollPosition="end"
          >
            <MessageScroller>
              <MessageScrollerViewport style={{ height: VIEWPORT_HEIGHT }}>
                <MessageScrollerContent className="gap-2 p-4">
                  <Transcript
                    isAgentRunning={isAgentRunning}
                    messages={steps[index] ?? []}
                  />
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function rowCount() {
  return document.querySelectorAll("[data-slot=message-scroller-item]").length;
}

// Resolve after a few real frames, so the scroller's rAF-scheduled work and the
// resize behind it have both run.
function settle(frames = 6) {
  return new Promise<void>((resolve) => {
    let remaining = frames;
    const tick = () => {
      if (remaining-- <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function spacerHeight() {
  const spacer = document.querySelector<HTMLElement>(
    "[data-message-scroller-spacer]",
  );

  return spacer ? Math.round(spacer.getBoundingClientRect().height) : 0;
}

function Transcript({
  isAgentRunning,
  messages,
}: {
  isAgentRunning: boolean;
  messages: unknown[];
}) {
  const { releaseAutoScroll } = useMessageScroller();

  return (
    <ChatStream
      isAgentRunning={isAgentRunning}
      isDeveloperMode={false}
      messages={messages as SessionMessage.WithParts[]}
      onContinue={vi.fn()}
      onModelChange={vi.fn()}
      onReleaseAutoScroll={releaseAutoScroll}
      onRetry={vi.fn()}
      onStartNewTask={vi.fn()}
      renderAsItems
      task={task}
    />
  );
}

function viewportOffset(element: Element) {
  const viewport = document.querySelector<HTMLElement>(
    "[data-slot=message-scroller-viewport]",
  );

  if (!viewport) {
    throw new Error("no scroller viewport");
  }

  return Math.round(
    element.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
  );
}

test("holds the turn in place when the wordmark gives way to the reply", async () => {
  const sent = [...history, message("user", "How did we do?")];
  const answered = [...sent, message("assistant", "Revenue grew.")];

  await render(<Harness steps={[history, sent, answered]} />);
  await settle();

  const step = page.getByRole("button", { name: "step" });

  // Sending: the turn arrives and is placed. Somewhere below the top of the
  // viewport and above its bottom, which a transcript this tall would not have
  // landed on by accident.
  await step.click();
  await settle();

  const placed = anchorOffset();
  const placedRowCount = rowCount();
  expect(placed).toBeGreaterThan(0);
  expect(placed).toBeLessThan(VIEWPORT_HEIGHT);

  // Answering: the wordmark leaves as the agent's first message arrives.
  await step.click();
  await settle();

  // The row count holding is the premise, not an aside. An unchanged count is
  // what sends this through the branch for an anchor that appeared in place;
  // if the wordmark ever stopped being swapped one-for-one, this would be
  // testing the append path instead and would pass without meaning anything.
  expect(rowCount()).toBe(placedRowCount);
  expect(anchorOffset()).toBe(placed);
});

test("leaves an idle transcript where it is when a folded run is opened", async () => {
  // A run with a turn after it. Folded, the steps behind the head line draw
  // nothing, so the messages holding them are not rows at all -- opening the
  // run puts them back, in the middle of the list, which is the part the
  // scroller must not read as a turn arriving.
  const messages = [
    ...history,
    message("user", "Check the numbers"),
    readStep("q1.csv"),
    readStep("q2.csv"),
    readStep("q3.csv"),
    message("assistant", "Revenue grew."),
    message("user", "And after that?"),
    message("assistant", "It kept growing."),
  ];

  await render(<Harness isAgentRunning={false} steps={[messages]} />);
  await settle();

  const head = [...document.querySelectorAll("*")].find(
    (element) =>
      element.children.length === 0 && element.textContent === "Read 3 files",
  );

  if (!head) {
    throw new Error("no folded run in the transcript");
  }

  // Clicking has to be a plain dispatch: a driver click scrolls its target into
  // view first, which is the movement under test.
  const closed = viewportOffset(head);
  const closedRowCount = rowCount();
  expect(closed).toBeGreaterThan(0);
  expect(closed).toBeLessThan(VIEWPORT_HEIGHT);

  (head as HTMLElement).click();
  await settle();

  // The premise: opening really does put rows back into the middle of the list.
  // Without that the scroller never sees an append here and this would pass
  // whether or not the bug was fixed.
  expect(rowCount()).toBeGreaterThan(closedRowCount);

  // Nothing was pinned, so nothing reserved room under the last turn for it,
  // and the row that was clicked is still under the pointer.
  expect(spacerHeight()).toBe(0);
  expect(viewportOffset(head)).toBe(closed);
});
