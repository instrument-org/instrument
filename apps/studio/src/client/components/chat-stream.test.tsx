import { renderWithProviders } from "@/tests/render";
import {
  type SessionMessage,
  type SessionMessagePart,
  StoreId,
  type Task,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatStream } from "./chat-stream";
import { TooltipProvider } from "./ui/tooltip";

const sessionId = StoreId.newSessionId();
const messageId = StoreId.newMessageId();

const task: Task = {
  createdAt: new Date(0),
  id: TaskIdSchema.parse("quarterly-numbers"),
  title: "Quarterly numbers",
  updatedAt: new Date(0),
};

interface RenderOptions {
  isAgentRunning?: boolean;
  isDeveloperMode?: boolean;
}

let partCounter = 0;

function activity(title: string) {
  return {
    input: { title },
    metadata: metadata(new Date(1)),
    output: {},
    state: "output-available",
    toolCallId: StoreId.ToolCallSchema.parse(`call-a${partCounter}`),
    type: "tool-start_activity",
  };
}

/** The heading call itself, off the queue and executing. */
function activityRunning(title: string) {
  return {
    input: { title },
    metadata: metadata(new Date(1)),
    state: "input-available",
    toolCallId: StoreId.ToolCallSchema.parse(`call-ar${partCounter}`),
    type: "tool-start_activity",
  };
}

/**
 * Clicks the first row reading `text`.
 *
 * A working group's head line is a copy of the step the agent is on, so once the
 * group is open that step is on screen twice: once heading it, once in its place
 * in the run. The first is the head.
 */
function clickRow(text: string) {
  const [row] = screen.getAllByText(text);
  if (!row) {
    throw new Error(`no row labelled ${text}`);
  }
  fireEvent.click(row);
}

function metadata(startedAt?: Date) {
  partCounter++;
  return {
    createdAt: new Date(0),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
    startedAt,
  };
}

function prose(text: string) {
  return { metadata: metadata(), state: "done", text, type: "text" };
}

/** Asked for by the model, and not yet picked up off the queue. */
function queued(explanation: string) {
  return {
    input: { explanation, filePath: "q3.csv" },
    metadata: metadata(),
    state: "input-available",
    toolCallId: StoreId.ToolCallSchema.parse(`call-q${partCounter}`),
    type: "tool-read_file",
  };
}

function read({
  explanation,
  running = false,
}: {
  explanation: string;
  running?: boolean;
}) {
  return running
    ? {
        input: { explanation, filePath: "q2.csv" },
        metadata: metadata(new Date(1)),
        state: "input-available",
        toolCallId: StoreId.ToolCallSchema.parse(`call-r${partCounter}`),
        type: "tool-read_file",
      }
    : {
        input: { explanation, filePath: "q1.csv" },
        metadata: { ...metadata(new Date(1)), endedAt: new Date(2) },
        output: {
          content: "region,revenue",
          displayedLines: 1,
          filePath: "q1.csv",
          hasMoreLines: false,
          modifiedAt: 0,
          offset: 1,
          state: "exists",
          totalLines: 1,
          truncatedByBytes: false,
        },
        state: "output-available",
        toolCallId: StoreId.ToolCallSchema.parse(`call-r${partCounter}`),
        type: "tool-read_file",
      };
}

function renderParts(parts: unknown[], options?: RenderOptions) {
  return renderSteps([parts], options);
}

/**
 * One assistant message per array, which is the shape a real turn has: the
 * agent emits a message per step, so a group of any size reaches across
 * several of them.
 */
function renderSteps(
  steps: unknown[][],
  { isAgentRunning = false, isDeveloperMode = false }: RenderOptions = {},
) {
  const messages = steps.map((parts) => ({
    id: StoreId.newMessageId(),
    metadata: { createdAt: new Date(0), sessionId },
    parts: parts as SessionMessagePart.Type[],
    role: "assistant",
  })) as SessionMessage.WithParts[];

  return renderWithProviders(
    <TooltipProvider>
      <ChatStream
        isAgentRunning={isAgentRunning}
        isDeveloperMode={isDeveloperMode}
        messages={messages}
        onContinue={vi.fn()}
        onModelChange={vi.fn()}
        onRetry={vi.fn()}
        onStartNewTask={vi.fn()}
        task={task}
      />
    </TooltipProvider>,
  );
}

// One turn: optionally a heading, a call that finished, the call in flight, and
// a call the model asked for that the queue has not reached.
function renderTranscript({
  isAgentRunning = true,
  isDeveloperMode = false,
  withActivity = true,
} = {}) {
  return renderParts(
    [
      ...(withActivity ? [activity("Reading each quarter")] : []),
      read({ explanation: "Reading the first quarter" }),
      read({ explanation: "Reading the second quarter", running: true }),
      queued("Reading the third quarter"),
    ],
    { isAgentRunning, isDeveloperMode },
  );
}

describe("ChatStream groups the agent named", () => {
  it("collapses to its heading and the one call in flight", () => {
    renderTranscript();

    expect(screen.getByText("Reading each quarter")).toBeDefined();
    expect(screen.getByText("Reading the second quarter")).toBeDefined();
    expect(screen.queryByText("Reading the first quarter")).toBeNull();
  });

  it("reopens as headings alone, with nothing left mid-flight", () => {
    renderTranscript({ isAgentRunning: false });

    expect(screen.getByText("Reading each quarter")).toBeDefined();
    expect(screen.queryByText("Reading the first quarter")).toBeNull();
    expect(screen.queryByText("Reading the second quarter")).toBeNull();
  });

  it("shows the steps that ran once the heading is opened", () => {
    renderTranscript();

    fireEvent.click(screen.getByText("Reading each quarter"));

    expect(screen.getByText("Reading the first quarter")).toBeDefined();
    expect(screen.getByText("Reading the second quarter")).toBeDefined();
  });

  // A heading that is still taking rows reads as running on its own, which is
  // the whole of what the planning row would say. Drawing both puts two live
  // indicators on screen for one agent.
  it("says it is working through the heading, and not twice", () => {
    renderSteps([[activityRunning("Reading each quarter")]], {
      isAgentRunning: true,
    });

    expect(screen.getByText("Reading each quarter").className).toContain(
      "brand-shiny-text",
    );
    expect(screen.queryByText("Planning...")).toBeNull();
  });

  it("keeps the copy of the step in flight with the heading, messages later", () => {
    renderSteps(
      [
        [activity("Reading each quarter")],
        [read({ explanation: "Reading the first quarter" })],
        [read({ explanation: "Reading the second quarter", running: true })],
      ],
      { isAgentRunning: true },
    );

    // Drawn where the group opened rather than where the step landed, so the
    // folded group holds still as the agent works down the transcript.
    const [inFlight] = screen.getAllByText("Reading the second quarter");
    expect(screen.getAllByText("Reading the second quarter")).toHaveLength(1);
    expect(inFlight?.closest(".pl-6")).not.toBeNull();
    expect(screen.queryByText("Reading the first quarter")).toBeNull();
  });
});

describe("ChatStream groups the agent never named", () => {
  const inFlight = () =>
    renderSteps(
      [
        [read({ explanation: "Reading the first quarter" })],
        [read({ explanation: "Reading the second quarter" })],
        [read({ explanation: "Reading the third quarter", running: true })],
      ],
      { isAgentRunning: true },
    );

  it("shows only the call in flight while the run is still going", () => {
    renderTranscript({ withActivity: false });

    expect(screen.getByText("Reading the second quarter")).toBeDefined();
    expect(screen.queryByText("Reading the first quarter")).toBeNull();
  });

  it("opens from the row heading it, since there is nothing else to click", () => {
    inFlight();

    expect(screen.queryByText("Reading the first quarter")).toBeNull();

    clickRow("Reading the third quarter");

    expect(screen.getByText("Reading the first quarter")).toBeDefined();
    expect(screen.getByText("Reading the second quarter")).toBeDefined();
  });

  it("shuts again from that same row, which opening leaves in place", () => {
    inFlight();

    clickRow("Reading the third quarter");
    clickRow("Reading the third quarter");

    expect(screen.queryByText("Reading the first quarter")).toBeNull();
  });

  it("heads the open run with a copy of the step, which keeps its own place", () => {
    inFlight();

    clickRow("Reading the third quarter");

    // Once heading the group, once where it falls in the run.
    expect(screen.getAllByText("Reading the third quarter")).toHaveLength(2);
  });

  it("names the finished run from what it turned out to contain", () => {
    renderParts([
      read({ explanation: "Reading the first quarter" }),
      read({ explanation: "Reading the second quarter" }),
      prose("Revenue grew in the north."),
    ]);

    expect(screen.getByText("Read 2 files")).toBeDefined();
    expect(screen.getByText("Revenue grew in the north.")).toBeDefined();
    expect(screen.queryByText("Reading the first quarter")).toBeNull();

    fireEvent.click(screen.getByText("Read 2 files"));
    expect(screen.getByText("Reading the first quarter")).toBeDefined();
  });
});

describe("ChatStream groups that span messages", () => {
  it("opens from the heading, whichever message holds the rest of the group", () => {
    renderSteps([
      [activity("Reading each quarter")],
      [read({ explanation: "Reading the first quarter" })],
      [read({ explanation: "Reading the second quarter" })],
      [prose("Revenue grew in the north.")],
    ]);

    expect(screen.queryByText("Reading the first quarter")).toBeNull();

    fireEvent.click(screen.getByText("Reading each quarter"));

    expect(screen.getByText("Reading the first quarter")).toBeDefined();
    expect(screen.getByText("Reading the second quarter")).toBeDefined();
  });

  it("draws no box for a message whose share of the group is all folded", () => {
    const { container } = renderSteps([
      [activity("Reading each quarter")],
      [read({ explanation: "Reading the first quarter" })],
      [read({ explanation: "Reading the second quarter" })],
      [prose("Revenue grew in the north.")],
    ]);

    // An empty group box keeps its margins, so it reads as blank space where
    // the folded steps used to be.
    const empty = [...container.querySelectorAll("div.gap-2")].filter(
      (element) => element.childElementCount === 0,
    );
    expect(empty).toHaveLength(0);
  });

  // A paragraph stays on screen while the phase it was written in is still
  // running: it is what the agent has to say about the work going on around it.
  // Never indented under it, though -- the answer a turn ends on is written
  // inside a phase and has to leave when the turn is over, and it can only do
  // that without moving if it was at the margin the whole time.
  it("holds a note at the margin while its phase runs", () => {
    renderSteps(
      [
        [activity("Reading each quarter")],
        [read({ explanation: "Reading the first quarter" })],
        [prose("These are older than I expected.")],
        [read({ explanation: "Reading the second quarter", running: true })],
      ],
      { isAgentRunning: true },
    );

    const note = screen.getByText("These are older than I expected.");
    expect(note).toBeDefined();
    expect(note.closest(".pl-6")).toBeNull();
  });

  // The whole point of the margin: the reply is in the same place before and
  // after the turn ends, and only its membership of the phase changes.
  it("leaves the reply exactly where it was written when the turn ends", () => {
    const steps = [
      [activity("Reading each quarter")],
      [read({ explanation: "Reading the first quarter" })],
      [prose("Revenue grew in the north.")],
    ];

    const running = renderSteps(steps, { isAgentRunning: true });
    const whileRunning = screen
      .getByText("Revenue grew in the north.")
      .closest(".pl-6");
    running.unmount();

    renderSteps(steps);

    expect(whileRunning).toBeNull();
    expect(
      screen.getByText("Revenue grew in the north.").closest(".pl-6"),
    ).toBeNull();
  });

  // A finished phase is one line. A paragraph left hanging under a heading that
  // has stopped saying anything is the mess that reads as. The reply the turn
  // ends on is not one of them: it leaves the phase and takes the margin.
  it("folds a note away once its phase is over, and keeps the reply", () => {
    renderSteps([
      [activity("Reading each quarter")],
      [read({ explanation: "Reading the first quarter" })],
      [prose("These are older than I expected.")],
      [activity("Charting them")],
      [read({ explanation: "Reading the chart script" })],
      [prose("Revenue grew in the north.")],
    ]);

    expect(screen.queryByText("These are older than I expected.")).toBeNull();
    expect(
      screen.getByText("Revenue grew in the north.").closest(".pl-6"),
    ).toBeNull();
  });

  it("gives the note back when the reader opens the phase again", () => {
    renderSteps([
      [activity("Reading each quarter")],
      [read({ explanation: "Reading the first quarter" })],
      [prose("These are older than I expected.")],
      [activity("Charting them")],
      [read({ explanation: "Reading the chart script" })],
    ]);

    clickRow("Reading each quarter");

    expect(screen.getByText("These are older than I expected.")).toBeDefined();
  });

  it("names a run the agent never named once, not once per message", () => {
    renderSteps([
      [read({ explanation: "Reading the first quarter" })],
      [read({ explanation: "Reading the second quarter" })],
      [prose("Revenue grew in the north.")],
    ]);

    expect(screen.getAllByText("Read 2 files")).toHaveLength(1);
  });
});

describe("ChatStream opening a turn", () => {
  // Between the user sending and the agent's first message arriving there is no
  // assistant message to hang the wordmark on, and planning is all there is to
  // show. Drawn without it, the turn opens on a bare "Planning..." and the
  // wordmark drops in above a moment later, pushing the turn down the page.
  it("heads the planning row with the wordmark, before the agent has spoken", () => {
    const { container } = renderWithProviders(
      <TooltipProvider>
        <ChatStream
          isAgentRunning
          isDeveloperMode={false}
          messages={
            [
              {
                id: StoreId.newMessageId(),
                metadata: { createdAt: new Date(0), sessionId },
                parts: [prose("Read every quarter.")],
                role: "user",
              },
            ] as SessionMessage.WithParts[]
          }
          onContinue={vi.fn()}
          onModelChange={vi.fn()}
          onRetry={vi.fn()}
          onStartNewTask={vi.fn()}
          task={task}
        />
      </TooltipProvider>,
    );

    const wordmark = container.querySelector("svg[viewBox='0 0 400 72']");
    if (!wordmark) {
      throw new Error("the turn opened without its wordmark");
    }
    const follows =
      wordmark.compareDocumentPosition(screen.getByText("Planning...")) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows).toBeTruthy();
  });

  // The message it would belong to changes underneath it: the agent's first
  // message arrives and the row would have to move out of the user's element
  // and into that one. Moved, it is a new element wherever it lands, so it
  // fades in a second time and the turn reads as announcing itself twice.
  it("keeps the same planning row when the agent's first message arrives", () => {
    const user = {
      id: StoreId.newMessageId(),
      metadata: { createdAt: new Date(0), sessionId },
      parts: [prose("Read every quarter.")],
      role: "user",
    };
    const stream = (messages: unknown[]) => (
      <TooltipProvider>
        <ChatStream
          isAgentRunning
          isDeveloperMode={false}
          messages={messages as SessionMessage.WithParts[]}
          onContinue={vi.fn()}
          onModelChange={vi.fn()}
          onRetry={vi.fn()}
          onStartNewTask={vi.fn()}
          task={task}
        />
      </TooltipProvider>
    );

    const { rerender } = renderWithProviders(stream([user]));
    const opened = screen.getByText("Planning...");

    rerender(
      stream([
        user,
        {
          id: StoreId.newMessageId(),
          metadata: { createdAt: new Date(0), sessionId },
          parts: [],
          role: "assistant",
        },
      ]),
    );

    expect(screen.getByText("Planning...")).toBe(opened);
  });
});

describe("ChatStream and the transcript's rhythm", () => {
  // A step row carries 4px of its own padding for the click target, and the
  // run it sits in pulls that back so its text lands on the 8px rhythm. A step
  // outside such a run is 4px lower than the step that replaces it, which lifts
  // the whole transcript the moment the agent starts doing something.
  it("puts the planning row in the same run box a step sits in", () => {
    renderSteps([[]], { isAgentRunning: true });

    expect(screen.getByText("Planning...").closest(".-my-1")).not.toBeNull();
  });
});

describe("ChatStream and the calls waiting behind the one running", () => {
  it("leaves a call the queue has not reached out of the transcript, expanded or not", () => {
    renderTranscript();

    fireEvent.click(screen.getByText("Reading each quarter"));
    expect(screen.queryByText("Reading the third quarter")).toBeNull();
  });

  it("draws the queue in developer mode", () => {
    renderTranscript({ isDeveloperMode: true });

    fireEvent.click(screen.getByText("Reading each quarter"));
    expect(screen.getByText("Reading the third quarter")).toBeDefined();
  });
});
