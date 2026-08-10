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
  alwaysShowFooter?: boolean;
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
  {
    alwaysShowFooter = false,
    isAgentRunning = false,
    isDeveloperMode = false,
  }: RenderOptions = {},
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
        alwaysShowFooter={alwaysShowFooter}
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

  // A heading that is still taking rows is what says the agent is working, and
  // it says it in the same shimmer any in-flight row uses.
  it("says it is working through the heading", () => {
    renderSteps([[activityRunning("Reading each quarter")]], {
      isAgentRunning: true,
    });

    expect(screen.getByText("Reading each quarter").className).toContain(
      "brand-shiny-text",
    );
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

  // A paragraph belongs to no phase, so it is at the margin from the moment it
  // is written and no fold anywhere can reach it.
  it("holds a note the agent wrote mid-turn at the margin", () => {
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

  // Everything the agent said stays said. Phases open and close above and below
  // it, and the paragraphs between them are untouched by any of that.
  it("keeps every note on screen as the phases around it come and go", () => {
    renderSteps([
      [activity("Reading each quarter")],
      [read({ explanation: "Reading the first quarter" })],
      [prose("These are older than I expected.")],
      [activity("Charting them")],
      [read({ explanation: "Reading the chart script" })],
      [prose("Revenue grew in the north.")],
    ]);

    expect(
      screen.getByText("These are older than I expected.").closest(".pl-6"),
    ).toBeNull();
    expect(
      screen.getByText("Revenue grew in the north.").closest(".pl-6"),
    ).toBeNull();
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

// The footer's row takes its space either way, so hover decides only whether
// that space has anything in it. That is fine where there is a pointer and
// wrong where there is not: the playback page measures the column's height, and
// a band of blank it cannot fill in reads as the transcript having gone wrong.
describe("ChatStream and the footer of a finished turn", () => {
  const footerRow = (container: HTMLElement) =>
    screen.getByLabelText("Branch from here").closest(".flex.min-w-0") ??
    container;

  it("leaves the footer to hover by default", () => {
    const { container } = renderSteps([
      [read({ explanation: "Reading the first quarter" })],
      [prose("Revenue grew in the north.")],
    ]);

    expect(footerRow(container).className).toContain("opacity-0");
  });

  it("draws the footer without hover when asked to", () => {
    const { container } = renderSteps(
      [
        [read({ explanation: "Reading the first quarter" })],
        [prose("Revenue grew in the north.")],
      ],
      { alwaysShowFooter: true },
    );

    expect(footerRow(container).className).not.toContain("opacity-0");
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
