import { renderInBrowser } from "@/tests/render-browser";
import {
  ChatIdSchema,
  type SessionMessage,
  StoreId,
  type ChatInfo,
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
 * Whether an open phase holds its height while the agent works through it.
 *
 * Each step passes through moments where the part it is on draws nothing yet:
 * a thought the provider closed before the call after it began, a call whose
 * input has landed and whose run the runtime has not marked started. A row that
 * drops out for one of those and comes back on the next is the whole open phase
 * jumping a line up and down, every step.
 */

vi.mock("@/client/hooks/use-host-paths", () => ({
  useHostPaths: (_taskId: unknown, filePaths: readonly string[]) =>
    Object.fromEntries(filePaths.map((path) => [path, `/computer/${path}`])),
}));

const ACTIVITY = "Creating a blank draft";

const sessionId = StoreId.newSessionId();

const task: ChatInfo = {
  createdAt: new Date(0),
  id: ChatIdSchema.parse("blank-draft"),
  title: "Blank draft",
  updatedAt: new Date(0),
};

const sent = {
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
      text: "Open Drafts and make a blank draft",
      type: "text",
    },
  ],
  role: "user",
};

interface Frame {
  label: string;
  messages: unknown[];
}

/**
 * One step as a reasoning model streams it: a thought with no words in it,
 * closed before the call after it begins, then a bash call writing its input,
 * waiting to be started, running, and done. Every frame is the transcript as it
 * stands at that moment, earlier steps included.
 */
function stepFrames(before: unknown[], step: number) {
  const messageId = StoreId.newMessageId();
  const at = (seconds: number) => new Date(step * 10_000 + seconds * 1000);
  const partMetadata = (extra: Record<string, unknown>) => ({
    messageId,
    sessionId,
    ...extra,
  });

  const reasoningId = StoreId.newPartId();
  const thought = (state: "done" | "streaming") => ({
    metadata: partMetadata({
      createdAt: at(0),
      id: reasoningId,
      ...(state === "done" ? { endedAt: at(1) } : {}),
    }),
    state,
    text: "",
    type: "reasoning",
  });

  const toolId = StoreId.newPartId();
  const input = {
    activity: ACTIVITY,
    command: `computer step-${step}`,
    explanation: `Step ${step}`,
  };
  const call = (state: string, extra: Record<string, unknown> = {}) => ({
    input: state === "input-streaming" ? { activity: ACTIVITY } : input,
    metadata: partMetadata({ createdAt: at(2), id: toolId, ...extra }),
    state,
    toolCallId: StoreId.ToolCallSchema.parse(`call-${step}`),
    type: "tool-bash",
    ...(state === "output-available" && {
      output: {
        command: input.command,
        commands: ["computer"],
        durationMs: 9,
        exitCode: 0,
        omittedBytes: 0,
        output: "ok",
      },
    }),
  });

  const frame = (label: string, parts: unknown[]): Frame => ({
    label: `step ${step}: ${label}`,
    messages: [
      ...before,
      {
        id: messageId,
        metadata: { createdAt: at(0), sessionId },
        parts,
        role: "assistant",
      },
    ],
  });

  const finished = frame("done", [
    thought("done"),
    call("output-available", { endedAt: at(4), startedAt: at(3) }),
  ]);
  return {
    frames: [
      frame("empty message", []),
      frame("thinking", [thought("streaming")]),
      frame("thought closed", [thought("done")]),
      frame("call streaming", [thought("done"), call("input-streaming")]),
      frame("call waiting to start", [
        thought("done"),
        call("input-available"),
      ]),
      frame("call running", [
        thought("done"),
        call("input-available", { startedAt: at(3) }),
      ]),
      finished,
    ],
    messages: finished.messages,
  };
}

function framesFor(stepCount: number) {
  const frames: Frame[] = [];
  let messages: unknown[] = [sent];
  for (let step = 1; step <= stepCount; step++) {
    const next = stepFrames(messages, step);
    frames.push(...next.frames);
    messages = next.messages;
  }
  return frames;
}

function Harness({ frames }: { frames: Frame[] }) {
  const [index, setIndex] = useState(0);

  return (
    <div className="flex flex-col" style={{ width: 640 }}>
      <button
        onClick={() => {
          setIndex((current) => current + 1);
        }}
        type="button"
      >
        step
      </button>
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller>
          <MessageScrollerViewport style={{ height: 600 }}>
            <MessageScrollerContent className="gap-2 p-4">
              <Transcript messages={frames[index]?.messages ?? []} />
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}

// Resolve after a few real frames, so layout and the scroller's rAF work have
// both run.
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

function Transcript({ messages }: { messages: unknown[] }) {
  const { releaseAutoScroll } = useMessageScroller();

  return (
    <TranscriptScrollContext value={releaseAutoScroll}>
      <ChatStream
        isAgentRunning
        isDeveloperMode={false}
        messages={messages as SessionMessage.WithParts[]}
        onContinue={vi.fn()}
        onModelChange={vi.fn()}
        onRetry={vi.fn()}
        onRunAgain={vi.fn()}
        renderAsItems
        task={task}
      />
    </TranscriptScrollContext>
  );
}

// The reply's row in the scroller, which every step grows inside.
function turnHeight() {
  const turn = [
    ...document.querySelectorAll<HTMLElement>(
      "[data-slot=message-scroller-item]",
    ),
  ].at(-1);
  return turn ? Math.round(turn.getBoundingClientRect().height) : 0;
}

test("holds an open phase's height through every moment of every step", async () => {
  const frames = framesFor(3);
  await renderInBrowser(<Harness frames={frames} />);
  await settle();

  const step = page.getByRole("button", { name: "step" });

  // Through the first step, until the phase has a heading to open it from.
  let index = 0;
  let heading: HTMLElement | undefined;
  while (!heading) {
    index++;
    await step.click();
    await settle();
    heading = [...document.querySelectorAll<HTMLElement>("*")].find(
      (element) =>
        element.children.length === 0 && element.textContent === ACTIVITY,
    );
  }
  heading.click();
  await settle();

  const drops: string[] = [];
  let previous = turnHeight();
  for (index++; index < frames.length; index++) {
    await step.click();
    await settle();
    const height = turnHeight();
    if (height < previous) {
      drops.push(`${frames[index]?.label ?? index}: ${previous} -> ${height}`);
    }
    previous = height;
  }

  // The premise: the phase really is open and really did grow, so the steps
  // are drawn one under another rather than as a single copy that would hold
  // its height whatever the rows did.
  expect(document.body.textContent).toContain("Step 1");
  expect(document.body.textContent).toContain("Step 3");
  expect(drops).toEqual([]);
});
