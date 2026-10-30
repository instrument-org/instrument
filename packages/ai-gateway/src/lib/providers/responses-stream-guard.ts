import {
  STREAM_ENDED_EARLY_CODE,
  STREAM_ENDED_EARLY_MESSAGE,
} from "@instrument-org/shared";

/**
 * A Responses API stream is over only when it says so: `response.completed`,
 * `response.incomplete`, `response.failed` or `error`. A body that closes
 * before one of those arrives is a reply cut off, and `@ai-sdk/openai` reads
 * it as a finish with reason `other` and no usage, so the turn ends with
 * nothing said and no error to show for it.
 *
 * The guard holds the lifecycle events a stream opens with until the first
 * event past them. A stream that closes while they are still held has given
 * the client nothing, so it is asked for once more without the client
 * knowing. Past that point the client may already have text or a tool call
 * in hand, so a stream that closes early instead ends with an `error` event
 * the SDK reports as a failure.
 */

const LIFECYCLE_EVENTS = new Set([
  "response.created",
  "response.in_progress",
  "response.queued",
]);

const TERMINAL_EVENTS = new Set([
  "error",
  "response.completed",
  "response.failed",
  "response.incomplete",
]);

/**
 * The event types `@ai-sdk/openai` reads. Anything else it drops as an
 * unknown chunk, so a terminal event under a name outside this set would end
 * a stream as silently as no terminal event at all.
 */
const SDK_EVENTS = new Set([
  ...LIFECYCLE_EVENTS,
  ...TERMINAL_EVENTS,
  "response.apply_patch_call_operation_diff.delta",
  "response.apply_patch_call_operation_diff.done",
  "response.code_interpreter_call_code.delta",
  "response.code_interpreter_call_code.done",
  "response.custom_tool_call_input.delta",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.image_generation_call.partial_image",
  "response.output_item.added",
  "response.output_item.done",
  "response.output_text.annotation.added",
  "response.output_text.delta",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary_text.delta",
]);

const RECENT_EVENT_COUNT = 8;
const DISTINCT_EVENT_CAP = 32;

/** What one attempt's stream carried, by event type only. */
interface StreamEvents {
  /** Whether the body ended partway through an event, which was dropped. */
  endedMidEvent: boolean;
  /** Every distinct event type, in the order each first arrived. */
  eventTypes: string[];
  /** The last few event types, oldest first. */
  lastEventTypes: string[];
  /** Whether events past the opening lifecycle ones reached the client. */
  outputBegan: boolean;
  /** Event types `@ai-sdk/openai` ignores. */
  unreadByClient: string[];
}

/**
 * One stream that ended without a terminal event, told once its outcome is
 * known: retried or not, and how the retry went.
 */
export interface StreamEndedEarly {
  first: StreamEvents;
  /** Absent when output had begun, so the stream was not asked for again. */
  retry?: "canceled" | "completed" | "ended-early" | "failed" | "refused";
  /** The status a refused retry was answered with. */
  retryStatus?: number;
  /** What a retry that also ended early carried. */
  second?: StreamEvents;
}

type Reader = ReadableStreamDefaultReader<Uint8Array>;

interface Opened {
  held: Uint8Array[];
  log: EventLog;
  /** Absent once the body has ended. */
  reader?: Reader;
  /** The client's request, whose abort cancels the body. */
  signal?: AbortSignal;
  /** What the body threw while it was being read, if it did. */
  thrown?: { error: unknown };
}

type AttemptEnd = "canceled" | "completed" | "ended-early" | "failed";

/**
 * `signal` is the client's request: once it is aborted the upstream body is
 * let go, and a stream that closed early is not asked for again.
 */
export async function guardResponsesStream({
  onEndedEarly,
  send,
  signal,
}: {
  onEndedEarly: (report: StreamEndedEarly) => void;
  send: () => Promise<Response>;
  signal?: AbortSignal;
}): Promise<Response> {
  const first = await send();
  if (!isEventStream(first)) {
    return first;
  }
  const opened = await openStream(first.body, signal);
  if (signal?.aborted) {
    return relay(first, opened, () => {});
  }
  // Past the lifecycle events, or broken rather than closed: either way not
  // the early close a retry is for.
  if (opened.log.pastLifecycle || opened.thrown) {
    return relay(first, opened, (end, log) => {
      if (end === "ended-early") {
        onEndedEarly({ first: log.summary() });
      }
    });
  }

  const firstEvents = opened.log.summary();
  let second: Response;
  try {
    second = await send();
  } catch {
    onEndedEarly({ first: firstEvents, retry: "failed" });
    return relay(first, opened, () => {});
  }
  if (!isEventStream(second)) {
    onEndedEarly({
      first: firstEvents,
      retry: "refused",
      retryStatus: second.status,
    });
    return second;
  }
  return relay(second, await openStream(second.body, signal), (end, log) => {
    onEndedEarly({
      first: firstEvents,
      retry: end,
      ...(end === "ended-early" && { second: log.summary() }),
    });
  });
}

function isEventStream(
  response: Response,
): response is Response & { body: ReadableStream<Uint8Array> } {
  return (
    response.ok &&
    response.body !== null &&
    (response.headers.get("content-type") ?? "").includes("text/event-stream")
  );
}

/**
 * Reads the body until the first event past the lifecycle ones, or its end.
 * An aborted client cancels the body, held or relayed.
 */
async function openStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<Opened> {
  const reader = body.getReader();
  const held: Uint8Array[] = [];
  const log = new EventLog();
  const cancel = () => {
    reader.cancel(signal?.reason).catch(() => {});
  };
  if (signal?.aborted) {
    cancel();
  } else {
    signal?.addEventListener("abort", cancel, { once: true });
  }
  for (;;) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } catch (error) {
      return { held, log, signal, thrown: { error } };
    }
    if (result.done) {
      log.end();
      return { held, log, signal };
    }
    const complete = log.push(result.value);
    if (complete) {
      held.push(complete);
    }
    if (log.pastLifecycle) {
      return { held, log, reader, signal };
    }
  }
}

/**
 * The held events, then the rest of the body as each event completes, then
 * an `error` event if the body ends before a terminal one.
 */
function relay(
  upstream: Response,
  { held, log, reader, signal, thrown }: Opened,
  onEnd: (end: AttemptEnd, log: EventLog) => void,
): Response {
  let ended = false;
  const end = (how: AttemptEnd) => {
    if (!ended) {
      ended = true;
      onEnd(how, log);
    }
  };
  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (log.terminal) {
      end("completed");
    } else if (signal?.aborted) {
      // The body ended because the client went away, not upstream.
      end("canceled");
    } else {
      controller.enqueue(endedEarlyEvent(log));
      end("ended-early");
    }
    controller.close();
  };
  const body = new ReadableStream<Uint8Array>({
    cancel: async (reason) => {
      end("canceled");
      await reader?.cancel(reason);
    },
    pull: async (controller) => {
      if (thrown) {
        end("failed");
        controller.error(thrown.error);
        return;
      }
      if (!reader) {
        close(controller);
        return;
      }
      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (error) {
          end("failed");
          controller.error(error);
          return;
        }
        if (result.done) {
          log.end();
          close(controller);
          return;
        }
        const complete = log.push(result.value);
        if (complete) {
          controller.enqueue(complete);
          return;
        }
      }
    },
    start: (controller) => {
      for (const chunk of held) {
        controller.enqueue(chunk);
      }
    },
  });
  const headers = new Headers(upstream.headers);
  headers.delete("content-length");
  return new Response(body, {
    headers,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}

/**
 * The `error` event in the nested shape `@ai-sdk/openai` parses. Only whole
 * events were passed on, so the client's parser is between events when it
 * arrives.
 */
function endedEarlyEvent(log: EventLog): Uint8Array {
  const event = {
    error: {
      code: STREAM_ENDED_EARLY_CODE,
      message: STREAM_ENDED_EARLY_MESSAGE,
      type: "server_error",
    },
    sequence_number: log.lastSequence + 1,
    type: "error",
  };
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * A blank line, which is what ends an event: two line endings in a row, each
 * `\r\n`, `\r` or `\n`, as the client's parser reads them.
 */
const EVENT_END = /(?:\r\n|\r(?!\n)|\n)(?:\r\n|\r(?!\n)|\n)/g;
const LINE_END = /\r\n|\r|\n/;

/**
 * Frames a Responses stream into whole events as it passes, and reads their
 * types, content unkept. An event counts only once the blank line ending it
 * arrives, since that is when the client's parser dispatches it; one the body
 * ends inside of is never dispatched, so it is never passed on either.
 */
class EventLog {
  /** Whether the body ended partway through an event, which was dropped. */
  endedMidEvent = false;
  lastSequence = -1;
  pastLifecycle = false;
  terminal = false;

  private decoder = new TextDecoder();
  private distinct = new Set<string>();
  private encoder = new TextEncoder();
  private pending = "";
  private recent: string[] = [];

  end() {
    this.pending += this.decoder.decode();
    this.endedMidEvent = this.pending.trim() !== "";
    this.pending = "";
  }

  /** The whole events this chunk completes, as bytes to pass on. */
  push(chunk: Uint8Array): undefined | Uint8Array {
    this.pending += this.decoder.decode(chunk, { stream: true });
    // A `\r` at the end may be the first half of a `\r\n`.
    const searched = this.pending.endsWith("\r")
      ? this.pending.slice(0, -1)
      : this.pending;
    let complete = 0;
    for (const match of searched.matchAll(EVENT_END)) {
      complete = match.index + match[0].length;
    }
    if (complete === 0) {
      return undefined;
    }
    const events = this.pending.slice(0, complete);
    this.pending = this.pending.slice(complete);
    for (const block of events.split(EVENT_END)) {
      this.read(block);
    }
    return this.encoder.encode(events);
  }

  summary(): StreamEvents {
    const eventTypes = [...this.distinct];
    return {
      endedMidEvent: this.endedMidEvent,
      eventTypes,
      lastEventTypes: [...this.recent],
      outputBegan: this.pastLifecycle,
      unreadByClient: eventTypes.filter((type) => !SDK_EVENTS.has(type)),
    };
  }

  private read(block: string) {
    const data = block
      .split(LINE_END)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") {
      return;
    }
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof event !== "object" || event === null) {
      return;
    }
    const type = "type" in event ? event.type : undefined;
    if (typeof type !== "string") {
      return;
    }
    const sequence =
      "sequence_number" in event ? event.sequence_number : undefined;
    if (typeof sequence === "number") {
      this.lastSequence = Math.max(this.lastSequence, sequence);
    }
    if (this.distinct.size < DISTINCT_EVENT_CAP) {
      this.distinct.add(type);
    }
    this.recent.push(type);
    if (this.recent.length > RECENT_EVENT_COUNT) {
      this.recent.shift();
    }
    if (TERMINAL_EVENTS.has(type)) {
      this.terminal = true;
    }
    if (!LIFECYCLE_EVENTS.has(type)) {
      this.pastLifecycle = true;
    }
  }
}
