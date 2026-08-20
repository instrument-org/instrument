import { renderInBrowser } from "@/tests/render-browser";
import {
  type SessionMessage,
  StoreId,
  type Task,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { ChatStream } from "./chat-stream";
import { TranscriptScrollContext } from "./transcript-scroll-context";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "./ui/message-scroller";

/**
 * Where an idle transcript comes to rest when a task is opened.
 *
 * Both assertions are measured scroll positions, so jsdom can say nothing about
 * either: with no layout engine the transcript is zero tall, the scroller never
 * overflows, and the test passes whatever the scroller did.
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

const history = Array.from({ length: 6 }, (_, index) => [
  message("user", `Question ${index + 1}`),
  message("assistant", `A paragraph of reply number ${index + 1}.`),
]).flat();

function distanceFromEnd() {
  const viewport = document.querySelector<HTMLElement>(
    "[data-slot=message-scroller-viewport]",
  );

  if (!viewport) {
    throw new Error("no scroller viewport");
  }

  return Math.round(
    viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
  );
}

// The task chat as it boots: the message list is a live query, so a cold open
// draws a loading row first and swaps the transcript in when it resolves.
function Harness({ startLoading }: { startLoading: boolean }) {
  const [isLoading, setIsLoading] = useState(startLoading);

  return (
    <div className="flex flex-col" style={{ width: 640 }}>
      <button
        onClick={() => {
          setIsLoading(false);
        }}
        type="button"
      >
        resolve
      </button>
      <MessageScrollerProvider autoScroll={false} defaultScrollPosition="end">
        <MessageScroller>
          <MessageScrollerViewport style={{ height: VIEWPORT_HEIGHT }}>
            <MessageScrollerContent className="gap-2 p-4">
              {isLoading ? <div>loading</div> : <Transcript />}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}

function settle(frames = 8) {
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

function Transcript() {
  const { releaseAutoScroll } = useMessageScroller();

  return (
    <TranscriptScrollContext value={releaseAutoScroll}>
      <ChatStream
        isAgentRunning={false}
        isDeveloperMode={false}
        messages={history as SessionMessage.WithParts[]}
        onContinue={vi.fn()}
        onModelChange={vi.fn()}
        onRetry={vi.fn()}
        onRunAgain={vi.fn()}
        onStartNewTask={vi.fn()}
        renderAsItems
        task={task}
      />
    </TranscriptScrollContext>
  );
}

test("opens at the end when the transcript is there on the first render", async () => {
  await renderInBrowser(<Harness startLoading={false} />);
  await settle();

  expect(distanceFromEnd()).toBe(0);
});

// The path a cold open takes. Warm navigation renders the transcript on the
// first commit and is covered above; a hard reload has nothing cached, so the
// loading row is drawn first and the transcript replaces it a frame later.
test("opens at the end when the transcript replaces a loading row", async () => {
  await renderInBrowser(<Harness startLoading />);
  await settle();

  await page.getByRole("button", { name: "resolve" }).click();
  await settle();

  expect(distanceFromEnd()).toBe(0);
});
