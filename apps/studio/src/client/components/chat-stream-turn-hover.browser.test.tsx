import { renderInBrowser } from "@/tests/render-browser";
import {
  type SessionMessage,
  StoreId,
  type Task,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { ChatStream } from "./chat-stream";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./ui/message-scroller";

/**
 * Which footer a hover brings up.
 *
 * The rule is a `group-hover` against the box a turn is drawn in, so nothing
 * short of a browser can answer it: jsdom has no cascade, and a test there
 * would be reading back the class name it was just handed.
 */

const sessionId = StoreId.newSessionId();

const task: Task = {
  createdAt: new Date(0),
  id: TaskIdSchema.parse("quarterly-numbers"),
  title: "Quarterly numbers",
  updatedAt: new Date(0),
};

// One reading per footer on screen, top to bottom. The footer row is the
// ancestor its controls sit on, which is the element the rule applies to.
function footerOpacities() {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[aria-label="Branch from here"]',
    ),
  ].map((button) => {
    const row = button.closest<HTMLElement>(".flex.min-w-0");

    if (!row) {
      throw new Error("a footer control outside a footer row");
    }

    return window.getComputedStyle(row).opacity;
  });
}

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

async function renderTranscript() {
  // Two turns, the first of them spread over two messages the way a real turn
  // is: its footer is drawn from the last of them, and the row a reader is on
  // is nearly always one of the others.
  const messages = [
    message("user", "How did we do?"),
    message("assistant", "Revenue grew in the north."),
    message("assistant", "The south held flat."),
    message("user", "And after that?"),
    message("assistant", "It kept growing."),
  ];

  await renderInBrowser(
    <div className="flex flex-col gap-4" style={{ width: 640 }}>
      <button type="button">off the transcript</button>
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport style={{ height: 600 }}>
            <MessageScrollerContent className="gap-2 p-4">
              <ChatStream
                isAgentRunning={false}
                isDeveloperMode={false}
                messages={messages as SessionMessage.WithParts[]}
                onContinue={vi.fn()}
                onModelChange={vi.fn()}
                onRetry={vi.fn()}
                onRunAgain={vi.fn()}
                onStartNewTask={vi.fn()}
                renderAsItems
                task={task}
              />
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>,
  );
}

test("brings up the footer of the turn under the pointer and no other", async () => {
  await renderTranscript();

  // Park the pointer off the transcript first. Nothing has moved it yet, so it
  // sits wherever the run happens to leave it, and a resting pointer that lands
  // on a turn raises that turn's footer before the first hover is ever issued.
  await page.getByRole("button", { name: "off the transcript" }).hover();
  expect(footerOpacities()).toEqual(["0", "0"]);

  // A row in the turn's first message; the footer it belongs to is drawn from
  // its second.
  await page.getByText("Revenue grew in the north.").hover();
  expect(footerOpacities()).toEqual(["1", "0"]);

  await page.getByText("It kept growing.").hover();
  expect(footerOpacities()).toEqual(["0", "1"]);

  await page.getByRole("button", { name: "off the transcript" }).hover();
  expect(footerOpacities()).toEqual(["0", "0"]);
});

// The prompt is not part of the reply to it, and hovering it is how a reader
// reads back what they asked for.
test("leaves the footer down while the pointer is on what the reader sent", async () => {
  await renderTranscript();

  await page.getByText("How did we do?").hover();

  expect(footerOpacities()).toEqual(["0", "0"]);
});
