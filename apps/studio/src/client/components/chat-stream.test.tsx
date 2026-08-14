import { renderWithProviders } from "@/tests/render";
import {
  type SessionMessage,
  StoreId,
  type Task,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { noop } from "radashi";
import { describe, expect, it, vi } from "vitest";

import { ChatStream } from "./chat-stream";
import { TranscriptScrollContext } from "./transcript-scroll-context";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./ui/message-scroller";
import { TooltipProvider } from "./ui/tooltip";

// An opened file card highlights what it is showing, and asks the app which
// theme to highlight against; the real provider answers through `matchMedia`
// and an RPC round trip, neither of which is here and neither of which any
// case below reads. `vi.mock` is hoisted above the imports either way.
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
    setTheme: vi.fn(),
    theme: "light",
  }),
}));

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
  releaseAutoScroll?: () => void;
  renderAsItems?: boolean;
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

function assistantMessage(
  parts: unknown[],
  extraMetadata: Record<string, unknown> = {},
) {
  return {
    id: StoreId.newMessageId(),
    metadata: { createdAt: new Date(0), sessionId, ...extraMetadata },
    parts,
    role: "assistant",
  };
}

/**
 * The transcript as one element, so a case that is about state surviving can
 * hand the same tree a later set of messages.
 */
function chatStream(
  messages: unknown[],
  {
    alwaysShowFooter = false,
    isAgentRunning = false,
    isDeveloperMode = false,
    releaseAutoScroll,
    renderAsItems = false,
  }: RenderOptions = {},
) {
  const stream = (
    <TranscriptScrollContext value={releaseAutoScroll ?? noop}>
      <ChatStream
        alwaysShowFooter={alwaysShowFooter}
        isAgentRunning={isAgentRunning}
        isDeveloperMode={isDeveloperMode}
        messages={messages as SessionMessage.WithParts[]}
        onContinue={vi.fn()}
        onModelChange={vi.fn()}
        onRetry={vi.fn()}
        onRunAgain={vi.fn()}
        onStartNewTask={vi.fn()}
        renderAsItems={renderAsItems}
        task={task}
      />
    </TranscriptScrollContext>
  );

  return (
    <TooltipProvider>
      {/* Rows only become scroller items inside a scroller, and only the
          top-level transcript is one. */}
      {renderAsItems ? (
        <MessageScrollerProvider>
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent>{stream}</MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      ) : (
        stream
      )}
    </TooltipProvider>
  );
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
    throw new Error(`no row labeled ${text}`);
  }
  fireEvent.click(row);
}

/**
 * The one call the transcript opens without being asked, in the two states that
 * matter; see `opensOnSight`.
 *
 * Both share the part the transcript keys everything on, since the whole
 * question is what survives the call finishing: two parts with two ids would be
 * two rows, and the state of the first one would have nowhere to go.
 */
function imageCall(explanation: string) {
  const input = {
    explanation,
    filePath: "./output/cover",
    prompt: "Four quarterly bars in muted ink on paper",
  };
  const seat = metadata(new Date(1));
  const toolCallId = StoreId.ToolCallSchema.parse(`call-g${partCounter}`);
  return {
    done: {
      input,
      metadata: { ...seat, endedAt: new Date(2) },
      output: {
        images: [
          {
            filePath: "output/cover.png",
            height: 1024,
            modifiedAt: 0,
            sizeBytes: 1024,
            width: 1024,
          },
        ],
        modelId: "openai/gpt-image-1",
        provider: { displayName: "OpenAI", id: "openai", type: "openai" },
        renamedToAvoidOverwrite: false,
        sourceImages: [],
        state: "success",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
      state: "output-available",
      toolCallId,
      type: "tool-generate_image",
    },
    running: {
      input,
      metadata: seat,
      state: "input-available",
      toolCallId,
      type: "tool-generate_image",
    },
  };
}

/**
 * Whether the row reading `text` is showing what the call itself produced.
 *
 * The *last* row by that name, which is the step in its place in the run: the
 * copy a group draws in its own slot comes from the slice the group opened in
 * and so is always above it. Which one is asked matters, because the copy is on
 * its way out at exactly the moment this is worth asking.
 */
function isRowOpen(text: string) {
  const row = screen.getAllByText(text).at(-1);
  // Read off the state rather than off the content: a collapsible that has been
  // opened once keeps its content mounted and hides it, so its presence says
  // only that the row was open at some point.
  return (
    row?.closest('[data-slot="collapsible"]')?.getAttribute("data-state") ===
    "open"
  );
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

function renderMessages(messages: unknown[], options?: RenderOptions) {
  return renderWithProviders(chatStream(messages, options));
}

function renderParts(parts: unknown[], options?: RenderOptions) {
  return renderSteps([parts], options);
}

/**
 * One assistant message per array, which is the shape a real turn has: the
 * agent emits a message per step, so a group of any size reaches across
 * several of them.
 */
function renderSteps(steps: unknown[][], options?: RenderOptions) {
  return renderMessages(
    steps.map((parts) => assistantMessage(parts)),
    options,
  );
}

// One turn: optionally a heading, a call that finished, the call in flight, and
// a call the model asked for that the queue has not reached.
function renderTranscript({
  isAgentRunning = true,
  isDeveloperMode = false,
  releaseAutoScroll,
  withActivity = true,
}: RenderOptions & { withActivity?: boolean } = {}) {
  return renderParts(
    [
      ...(withActivity ? [activity("Reading each quarter")] : []),
      read({ explanation: "Reading the first quarter" }),
      read({ explanation: "Reading the second quarter", running: true }),
      queued("Reading the third quarter"),
    ],
    { isAgentRunning, isDeveloperMode, releaseAutoScroll },
  );
}

function userMessage(text: string) {
  return {
    id: StoreId.newMessageId(),
    metadata: { createdAt: new Date(0), sessionId },
    parts: [prose(text)],
    role: "user",
  };
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

// The wordmark is the anchor that says the agent has the message, so what it
// waits for is the turn starting and not the first row landing. A turn that
// produced nothing keeps none of it: an empty header over a stack of user
// messages reads as a reply that failed to draw.
describe("ChatStream and the wordmark over a turn", () => {
  const wordmark = (container: HTMLElement) =>
    container.querySelector("svg[viewBox='0 0 400 72']");

  const aborted = { error: { kind: "aborted", message: "Aborted" } };

  it("heads the turn before the agent has a message of its own", () => {
    const { container } = renderMessages([userMessage("Read every quarter.")], {
      isAgentRunning: true,
    });

    expect(wordmark(container)).not.toBeNull();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("keeps it when the agent's first message lands with nothing in it", () => {
    const { container } = renderMessages(
      [userMessage("Read every quarter."), assistantMessage([])],
      { isAgentRunning: true },
    );

    expect(wordmark(container)).not.toBeNull();
    expect(screen.getByText("Planning")).toBeDefined();
  });

  // One wordmark per turn. The planning row draws its own at the tail, so the
  // empty message it is standing in for must not draw a second.
  it("heads the opening turn once while it is still empty", () => {
    const { container } = renderMessages(
      [userMessage("Read every quarter."), assistantMessage([])],
      { isAgentRunning: true },
    );

    expect(
      container.querySelectorAll("svg[viewBox='0 0 400 72']"),
    ).toHaveLength(1);
  });

  it("drops it for a turn stopped before it produced anything", () => {
    const { container } = renderMessages([
      userMessage("Read every quarter."),
      assistantMessage([], aborted),
    ]);

    expect(wordmark(container)).toBeNull();
  });

  // The turn is over and still empty however many messages follow it, so the
  // wordmark cannot arrive later just because the transcript moved on.
  it("leaves it off a stopped turn the conversation has moved past", () => {
    const { container } = renderMessages([
      userMessage("Read every quarter."),
      assistantMessage([], aborted),
      userMessage("Read every quarter."),
      assistantMessage([], aborted),
    ]);

    expect(wordmark(container)).toBeNull();
  });

  it("heads a turn that failed, which is something to show", () => {
    const { container } = renderMessages([
      userMessage("Read every quarter."),
      assistantMessage([], {
        error: {
          kind: "api-call",
          message: "no",
          name: "APICallError",
          url: "",
        },
      }),
    ]);

    expect(wordmark(container)).not.toBeNull();
  });

  it("heads a turn that said something", () => {
    const { container } = renderMessages([
      userMessage("Read every quarter."),
      assistantMessage([prose("Revenue grew in the north.")]),
    ]);

    expect(wordmark(container)).not.toBeNull();
  });

  // Planning is the opening of a turn and nothing else. Once the turn has drawn
  // anything the row is gone, and it does not come back for the pauses between
  // one step and the next.
  it("drops planning as soon as the turn has drawn something", () => {
    renderMessages(
      [
        userMessage("Read every quarter."),
        assistantMessage([prose("Revenue grew in the north.")]),
      ],
      { isAgentRunning: true },
    );

    expect(screen.queryByText("Planning")).toBeNull();
  });
});

// 24px where a paragraph meets a run of steps, against the 8px the rest of the
// transcript sits on: 16px of it here, on top of the container's own gap. It
// hangs off the lower of the two rows so that nothing already drawn changes
// height when the agent takes its next step.
describe("ChatStream and the space around what the agent said", () => {
  const runBox = (text: string) => screen.getByText(text).closest(".-my-1");

  it("opens the boundary above a paragraph written under a run", () => {
    renderMessages([
      userMessage("Read every quarter."),
      assistantMessage([
        read({ explanation: "Reading the first quarter" }),
        read({ explanation: "Reading the second quarter" }),
        prose("These are older than I expected."),
      ]),
    ]);

    expect(
      screen.getByText("These are older than I expected.").closest(".mt-4"),
    ).not.toBeNull();
  });

  // As padding, since the box's own negative margin is what holds its steps on
  // the rhythm and a margin here would be resolved against it.
  it("opens it again where the run after that paragraph starts", () => {
    renderMessages([
      userMessage("Read every quarter."),
      assistantMessage([
        prose("I will read the quarters."),
        read({ explanation: "Reading the first quarter" }),
        read({ explanation: "Reading the second quarter" }),
      ]),
    ]);

    expect(runBox("Read 2 files")?.className).toContain("pt-4");
  });

  it("leaves one phase against the next on the transcript's own rhythm", () => {
    renderMessages([
      userMessage("Read every quarter."),
      assistantMessage([
        activity("Reading each quarter"),
        read({ explanation: "Reading the first quarter" }),
        activity("Charting them"),
        read({ explanation: "Reading the chart script" }),
      ]),
    ]);

    expect(runBox("Charting them")?.className).not.toContain("pt-4");
  });

  it("leaves the run that opens a turn alone, which the wordmark spaces", () => {
    renderMessages([
      userMessage("Read every quarter."),
      assistantMessage([
        activity("Reading each quarter"),
        read({ explanation: "Reading the first quarter" }),
      ]),
    ]);

    expect(runBox("Reading each quarter")?.className).not.toContain("pt-4");
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

  /**
   * The row is there for both states and only its visibility changes, so the
   * turn ending does not grow the transcript by a row and the next turn starting
   * does not take that row back out. Which state the transcript believes it is
   * in arrives from a different live query than the messages do, so the two
   * disagree for a frame or two on every submit -- and this is what makes being
   * wrong for those frames cost nothing.
   */
  it("holds the footer's space while the turn is still being written", () => {
    const live = renderSteps(
      [
        [read({ explanation: "Reading the first quarter" })],
        [prose("Revenue grew in the north.")],
      ],
      { isAgentRunning: true },
    );

    expect(footerRow(live.container).className).toContain("invisible");

    live.unmount();

    const finished = renderSteps([
      [read({ explanation: "Reading the first quarter" })],
      [prose("Revenue grew in the north.")],
    ]);

    expect(footerRow(finished.container).className).not.toContain("invisible");
  });
});

/**
 * Which rows the scroller is told a turn starts at. Where those rows come to
 * rest is layout, and jsdom has none; this is only the marking.
 */
describe("ChatStream and the turn the scroller anchors", () => {
  // A row is labeled by its message rather than by everything under it: the
  // hover footer carries a timestamp, and which day an instant falls on depends
  // on the time zone the suite runs in.
  const anchoring = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>("[data-scroll-anchor]")].map(
      (item) => {
        const message =
          item.querySelector<HTMLElement>(
            '[data-slot="user-message-content"]',
          ) ?? item;
        return `${item.dataset.scrollAnchor ?? ""} ${message.textContent.slice(0, 20)}`;
      },
    );

  // Two rows for a two-message reply would be two rows the scroller has to
  // agree about; the reply is one thing that grows. So the run of steps is one
  // row whatever it is spread over, and only what the reader sent is a start.
  it("starts a turn at what the user sent and nowhere else", () => {
    const { container } = renderMessages(
      [
        userMessage("How did we do?"),
        assistantMessage([read({ explanation: "Reading the first quarter" })]),
        assistantMessage([prose("Revenue grew in the north.")]),
      ],
      { renderAsItems: true },
    );

    expect(anchoring(container)).toMatchInlineSnapshot(`
      [
        "true How did we do?",
        "false Reading the first qu",
      ]
    `);
  });

  // The window between sending and the agent's first message: the wordmark is
  // standing in for a turn that has produced nothing, and the message under it
  // is already the anchor. Marking it too would give one turn two starts.
  it("does not start a turn at the wordmark holding the place for one", () => {
    const { container } = renderMessages([userMessage("How did we do?")], {
      isAgentRunning: true,
      renderAsItems: true,
    });

    expect(anchoring(container)).toMatchInlineSnapshot(`
      [
        "true How did we do?",
        "false Planning",
      ]
    `);
  });

  it("hands scrolling back to the reader before opening a group under them", () => {
    const releaseAutoScroll = vi.fn();
    renderTranscript({ releaseAutoScroll });

    clickRow("Reading each quarter");

    expect(releaseAutoScroll).toHaveBeenCalledOnce();
  });
});

/**
 * A step inside a folded phase is on screen for exactly as long as the agent is
 * on it: the fold draws one line for the whole phase, and the next step takes
 * that line. So a step the reader opens takes the phase open with it, which is
 * what leaves it somewhere to be once the agent has moved on.
 */
describe("ChatStream and a step the reader opened", () => {
  // Built once per case and handed back unchanged, since a rebuilt part is a
  // new part: what is under test is a row keeping its state as the run grows
  // around it, and a fresh id would have nothing to keep.
  const phase = () =>
    [
      [activity("Reading each quarter")],
      [read({ explanation: "Reading the first quarter" })],
      // The agent between steps, which is where a reader gets the chance to
      // click at all: the group falls back to the last step it took for the
      // line it draws while it works out what to do next.
      [read({ explanation: "Reading the second quarter" })],
    ].map((parts) => assistantMessage(parts));

  it("opens the phase around it", () => {
    renderMessages(phase(), { isAgentRunning: true });

    expect(screen.queryByText("Reading the first quarter")).toBeNull();

    clickRow("Reading the second quarter");

    expect(screen.getByText("Reading the first quarter")).toBeDefined();
    expect(isRowOpen("Reading the second quarter")).toBe(true);
  });

  it("keeps it open as the agent works past it", () => {
    const messages = phase();
    const { rerender } = renderMessages(messages, { isAgentRunning: true });

    clickRow("Reading the second quarter");

    // The agent takes its next step, which replaces the copy the group draws in
    // its own slot -- and used to take the opened row away with it.
    rerender(
      chatStream(
        [
          ...messages,
          assistantMessage([
            read({ explanation: "Reading the third quarter", running: true }),
          ]),
        ],
        { isAgentRunning: true },
      ),
    );

    expect(screen.getByText("Reading the third quarter")).toBeDefined();
    // Still in the phase, which is still open, and still showing what it read.
    expect(screen.getByText("Reading the first quarter")).toBeDefined();
    expect(isRowOpen("Reading the second quarter")).toBe(true);
  });

  it("leaves the phase open once the reader shuts the step again", () => {
    renderMessages(phase(), { isAgentRunning: true });

    clickRow("Reading the second quarter");
    clickRow("Reading the second quarter");

    expect(isRowOpen("Reading the second quarter")).toBe(false);
    expect(screen.getByText("Reading the first quarter")).toBeDefined();
  });
});

/**
 * Image generation runs for the better part of a minute and what it produces is
 * a picture, so the line saying it started is not a stand-in for it the way it
 * is for every other call. The transcript opens it without being asked.
 */
describe("ChatStream and the step that opens itself", () => {
  // One phase, one image call in it, and the call's two states sharing a part;
  // see `imageCall`. `drawing` is the transcript while it is being drawn.
  const phase = () => {
    const image = imageCall("Drawing the cover");
    const opening = [
      assistantMessage([activity("Illustrating the write-up")]),
      assistantMessage([read({ explanation: "Reading the brief" })]),
    ];
    return {
      drawing: [...opening, assistantMessage([image.running])],
      drawn: [...opening, assistantMessage([image.done])],
    };
  };

  it("opens an image being drawn, and the phase around it", () => {
    renderMessages(phase().drawing, { isAgentRunning: true });

    expect(isRowOpen("Drawing the cover")).toBe(true);
    expect(screen.getByText("Reading the brief")).toBeDefined();
  });

  it("leaves it open once it is drawn and the run has moved on", () => {
    const { drawing, drawn } = phase();
    const { rerender } = renderMessages(drawing, { isAgentRunning: true });

    rerender(
      chatStream(
        [
          ...drawn,
          assistantMessage([
            read({ explanation: "Reading the write-up", running: true }),
          ]),
        ],
        { isAgentRunning: true },
      ),
    );

    expect(screen.getByText("Reading the write-up")).toBeDefined();
    expect(isRowOpen("Drawing the cover")).toBe(true);
  });

  it("does not open it again over a reader who shut it", () => {
    const { drawing } = phase();
    const { rerender } = renderMessages(drawing, { isAgentRunning: true });

    clickRow("Drawing the cover");
    expect(isRowOpen("Drawing the cover")).toBe(false);

    rerender(chatStream([...drawing], { isAgentRunning: true }));

    expect(isRowOpen("Drawing the cover")).toBe(false);
  });

  // Drawn without a phase announced first, the image heads a run of its own:
  // the head line is a copy of the row itself, so opening the run puts the same
  // call on screen twice. The picture belongs to the row in the run, not both.
  it("draws the picture once when the run it opens has no heading", () => {
    const image = imageCall("Drawing the cover");

    renderMessages([assistantMessage([image.running])], {
      isAgentRunning: true,
    });

    expect(screen.getAllByText("Drawing the cover")).toHaveLength(2);
    expect(screen.getAllByText("Generating")).toHaveLength(1);
  });

  // Opening it is about watching it happen. A task reopened afterwards is a
  // list of the phases it went through, the same as any other.
  it("leaves a finished one folded away in a transcript being reread", () => {
    renderMessages(phase().drawn);

    expect(screen.queryByText("Drawing the cover")).toBeNull();
    expect(screen.queryByText("Reading the brief")).toBeNull();
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
