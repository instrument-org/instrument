import {
  type SessionMessage,
  type SessionMessagePart,
  StoreId,
} from "@instrument-org/workspace/client";

import { type Act, type ToolCall, type ToolType } from "./script";

/** One moment in the transcript: what the chat stream would draw right then. */
export interface Frame {
  /** Whether the agent is still working as of this frame. */
  isAgentRunning: boolean;
  /** What happened to produce it, for the timeline to draw. */
  mark: FrameMark;
  messages: SessionMessage.WithParts[];
}

/**
 * What a frame is, as data rather than a sentence.
 *
 * The timeline is a map of the run, so it wants the shape of each step -- which
 * tool, how far along -- and not the prose the transcript itself is already
 * showing. An explanation is the row's own job; here it is the thing that
 * pushes everything useful off the right-hand edge.
 */
export interface FrameMark {
  /**
   * What the call was about, from its own input. The transcript may draw
   * nothing for it -- an activity with a blank title does not -- and then this
   * is the only way to tell from the timeline what the frame even was.
   */
  detail?: string;
  kind: "call" | "planning" | "prose" | "reasoning" | "turn" | "user";
  /** Where the step has got to, for the kinds that pass through states. */
  phase?:
    | "arriving"
    | "asked for"
    | "done"
    | "failed"
    | "running"
    | "settled"
    | "stopped"
    | "streaming";
  /** The tool, when the frame is a call, so the row can draw its icon. */
  toolType?: ToolType;
}

// How far the clock moves between frames. Fixed, so a scenario reads the same
// every time it is built and the durations rows report are stable.
const TICK_MS = 400;

/** Where one call lives: fixed for its whole life, so its states replace it. */
interface Seat {
  metadata: SessionMessagePart.ToolPartMetadata;
  toolCallId: StoreId.ToolCall;
}

class Playback {
  private clock: number;
  private readonly frames: Frame[] = [];
  private messages: SessionMessage.WithParts[] = [];
  private running = true;
  private readonly sessionId = StoreId.newSessionId();
  private toolCallCounter = 0;

  // A scenario keeps its own clock so it reads the same every time it is built.
  // Where that clock starts still matters: a row that is still running measures
  // itself against now, so a transcript stamped in 1970 reports a step as
  // having taken decades.
  constructor(startedAt: number) {
    this.clock = startedAt;
  }

  run(script: Act[]): Frame[] {
    for (const act of script) {
      this.act(act, true);
    }
    if (this.running) {
      this.running = false;
      this.snapshot({ kind: "turn", phase: "settled" });
    }
    return this.frames;
  }

  private act(act: Act, ownStep: boolean) {
    switch (act.kind) {
      case "batch": {
        this.batch(act.calls, ownStep);
        return;
      }
      case "call": {
        this.call(act, ownStep);
        return;
      }
      case "pause": {
        // No change to the parts: with nothing in flight the stream falls to
        // its planning row, and this is where that gets looked at.
        this.snapshot({ kind: "planning" });
        return;
      }
      case "prose": {
        this.stream(act.text, "text", ownStep, act.chunkCount);
        return;
      }
      case "reasoning": {
        this.stream(act.text, "reasoning", ownStep);
        return;
      }
      case "same-step": {
        this.beginStep();
        for (const inner of act.acts) {
          this.act(inner, false);
        }
        return;
      }
      case "stop": {
        this.running = false;
        this.snapshot({ kind: "turn", phase: "stopped" });
        return;
      }
      case "user": {
        this.user(act.text);
        return;
      }
    }
  }

  // A response asking for several calls at once. They all arrive together and
  // then run one at a time, which is the shape that makes a queued call
  // distinguishable from a running one in the first place.
  private batch(calls: ToolCall[], ownStep: boolean) {
    if (ownStep) {
      this.beginStep();
    }
    const opened = calls.map((call) => {
      const seat = this.newSeat();
      this.put(toolPart(call, seat, "queued"));
      this.snapshot(mark(call, "asked for"));
      return { call, seat };
    });
    for (const { call, seat } of opened) {
      this.put(toolPart(call, seat, "running", this.time()));
      this.snapshot(mark(call, "running"));
      this.put(toolPart(call, seat, "finished", this.time()));
      this.snapshot(mark(call, "error" in call ? "failed" : "done"));
    }
  }

  private beginStep() {
    this.messages = [
      ...this.messages,
      {
        id: StoreId.newMessageId(),
        metadata: {
          createdAt: this.time(),
          finishReason: "tool-calls",
          modelId: "claude-sonnet-5",
          providerId: "anthropic",
          sessionId: this.sessionId,
        },
        parts: [],
        role: "assistant",
      },
    ];
  }

  private call(call: ToolCall, ownStep: boolean) {
    if (ownStep) {
      this.beginStep();
    }
    // No queued frame. A call with nothing ahead of it is picked up the moment
    // its input is complete, so the wait a batch's members sit through does not
    // exist here -- and drawing it produces a frame where the row has vanished
    // and the agent looks like it is thinking again.
    const seat = this.newSeat();
    this.put(toolPart(call, seat, "streaming"));
    this.snapshot(mark(call, "arriving"));
    this.put(toolPart(call, seat, "running", this.time()));
    this.snapshot(mark(call, "running"));
    this.put(toolPart(call, seat, "finished", this.time()));
    this.snapshot(mark(call, "error" in call ? "failed" : "done"));
  }

  private newSeat(): Seat {
    this.toolCallCounter++;
    return {
      metadata: this.partMetadata(),
      toolCallId: StoreId.ToolCallSchema.parse(
        `call_${this.toolCallCounter.toString()}`,
      ),
    };
  }

  private partMetadata(): SessionMessagePart.ToolPartMetadata {
    const message = this.messages.at(-1);
    if (!message) {
      throw new Error("a part needs a message to land in");
    }
    return {
      createdAt: this.time(),
      id: StoreId.newPartId(),
      messageId: message.id,
      sessionId: this.sessionId,
    };
  }

  // Writes a part into the open step, replacing the one it already has under
  // that id. Replacing rather than appending is what makes a call's states
  // successive frames of one row instead of a run of rows.
  private put(part: SessionMessagePart.Type) {
    const message = this.messages.at(-1);
    if (message?.role !== "assistant") {
      throw new Error("a part needs an open assistant step to land in");
    }
    const index = message.parts.findIndex(
      (existing) => existing.metadata.id === part.metadata.id,
    );
    this.messages = [
      ...this.messages.slice(0, -1),
      {
        ...message,
        parts:
          index === -1
            ? [...message.parts, part]
            : message.parts.with(index, part),
      },
    ];
  }

  private snapshot(what: FrameMark) {
    this.frames.push({
      isAgentRunning: this.running,
      mark: what,
      messages: this.messages,
    });
  }

  // Text and reasoning both arrive a piece at a time and then settle, which is
  // the only way to see a row that is growing rather than one that has grown.
  private stream(
    text: string,
    type: "reasoning" | "text",
    ownStep: boolean,
    chunkCount?: number,
  ) {
    if (ownStep) {
      this.beginStep();
    }
    const metadata = this.partMetadata();
    const kind = type === "text" ? "prose" : "reasoning";
    for (const partial of growingChunks(text, chunkCount)) {
      this.put({ metadata, state: "streaming", text: partial, type });
      this.snapshot({ kind, phase: "streaming" });
    }
    this.put({
      metadata: { ...metadata, endedAt: this.time() },
      state: "done",
      text,
      type,
    });
    this.snapshot({ kind, phase: "settled" });
  }

  private time(): Date {
    this.clock += TICK_MS;
    return new Date(this.clock);
  }

  private user(text: string) {
    const messageId = StoreId.newMessageId();
    this.messages = [
      ...this.messages,
      {
        id: messageId,
        metadata: { createdAt: this.time(), sessionId: this.sessionId },
        parts: [
          {
            metadata: {
              createdAt: this.time(),
              id: StoreId.newPartId(),
              messageId,
              sessionId: this.sessionId,
            },
            state: "done",
            text,
            type: "text",
          },
        ],
        role: "user",
      },
    ];
    this.snapshot({ kind: "user" });
  }
}

/**
 * Every state the transcript passes through as a scenario plays out.
 *
 * The whole point is that this is a fold: frame `n` is the transcript after the
 * first `n` events and nothing else, so scrubbing is indexing and there is no
 * timer anywhere in the model. Playing is a timer advancing the index, which
 * means play, drag, and single-step all show the same thing.
 *
 * Frames share structure. Each one replaces only the message and the part that
 * changed, so React's identity checks see exactly what a live stream would
 * change and the memoized layout pass is exercised the way it is in the app.
 */
export function buildFrames(script: Act[], startedAt = 0): Frame[] {
  return new Playback(startedAt).run(script);
}

/** Successively longer prefixes of `text`, broken at word boundaries. */
function growingChunks(text: string, count = 3): string[] {
  const words = text.split(" ");
  if (words.length <= count) {
    return [text];
  }
  const step = Math.ceil(words.length / (count + 1));
  const chunks: string[] = [];
  for (let taken = step; taken < words.length; taken += step) {
    chunks.push(words.slice(0, taken).join(" "));
  }
  return chunks;
}

const DETAIL_FIELDS = [
  "title",
  "explanation",
  "command",
  "filePath",
  "query",
  "prompt",
];

function mark(call: ToolCall, phase: FrameMark["phase"]): FrameMark {
  const fields: [string, unknown][] = Object.entries(call.input);
  for (const field of DETAIL_FIELDS) {
    const value = fields.find(([key]) => key === field)?.[1];
    if (typeof value === "string") {
      // Kept even when empty: a blank title is exactly the case worth seeing.
      return {
        detail: `${field}: ${value}`,
        kind: "call",
        phase,
        toolType: call.type,
      };
    }
  }
  return { kind: "call", phase, toolType: call.type };
}

/**
 * One tool call at one point in its life.
 *
 * The casts are the only ones in the module and they do not weaken what a
 * scenario author writes: `ToolCall` is a union of per-tool shapes, so `input`
 * and `output` are checked against `type` at the point the call is written.
 * TypeScript cannot carry that pairing through a variable of the union type --
 * from here it sees every `type` paired with every `input` -- and narrowing it
 * back would take a branch per tool, which is exactly the list that goes stale.
 * The one phase with no input needs no cast, which is the shape of the problem.
 */
function toolPart(
  call: ToolCall,
  seat: Seat,
  phase: "finished" | "queued" | "running" | "streaming",
  at?: Date,
): SessionMessagePart.ToolPart {
  const base = { toolCallId: seat.toolCallId, type: call.type };

  if (phase === "streaming") {
    // No input yet, which is the row drawn from the tool's name alone.
    return {
      ...base,
      input: undefined,
      metadata: seat.metadata,
      state: "input-streaming",
    };
  }
  if (phase === "queued") {
    return {
      ...base,
      input: call.input,
      metadata: seat.metadata,
      state: "input-available",
    } as SessionMessagePart.ToolPart;
  }

  const metadata = {
    ...seat.metadata,
    startedAt: at ?? seat.metadata.createdAt,
  };
  if (phase === "running") {
    return {
      ...base,
      input: call.input,
      metadata,
      state: "input-available",
    } as SessionMessagePart.ToolPart;
  }

  const ended = { ...metadata, endedAt: at ?? metadata.startedAt };
  return "error" in call
    ? ({
        ...base,
        errorText: call.error,
        input: call.input,
        metadata: ended,
        state: "output-error",
      } as SessionMessagePart.ToolPart)
    : ({
        ...base,
        input: call.input,
        metadata: ended,
        output: call.output,
        state: "output-available",
      } as SessionMessagePart.ToolPart);
}
