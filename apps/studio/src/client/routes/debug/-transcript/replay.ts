import {
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type StoreId,
  transcriptMessage,
  turnsOf,
} from "@instrument-org/workspace/client";
import { LOCAL_RPC_DEFAULTS } from "@/client/lib/local-rpc-defaults";
import { MutationCache, QueryClient } from "@tanstack/react-query";

import {
  callDetail,
  type Frame,
  type FrameMark,
  growingChunks,
} from "./frames";

type Message = SessionMessage.WithParts;
type Part = SessionMessagePart.Type;

/** One change to a message. Without a `mark` it lands with the next frame. */
interface Beat {
  at: number;
  head?: Message;
  mark?: FrameMark;
  parts?: Part[];
}

/** A longer run opens part way through, so the page stays usable. */
const MAX_FRAMES = 3000;

/** Every `useMutation` under it fails before reaching the app, so no card in a replay can write. */
export const readOnlyClient = new QueryClient({
  defaultOptions: LOCAL_RPC_DEFAULTS,
  mutationCache: new MutationCache({
    onMutate: () => {
      throw new Error("A replayed chat is read-only");
    },
  }),
});

/** The chat from its `count`th turn from the end, or all of it when shorter. */
export function lastTurns(stored: Message[], count: number): Message[] {
  const light = stored.flatMap((message) => transcriptMessage(message) ?? []);
  const openers = turnsOf(light, { isRunning: false }).filter((t) => t.opener);
  const index = stored.findIndex(({ id }) => id === openers.at(-count)?.id);
  return index > 0 ? stored.slice(index) : stored;
}

/** A finished call writing, running, then as stored; one still going only as stored. */
function callBeats(part: SessionMessagePart.ToolPart, from: number): Beat[] {
  const detail = callDetail(part.input);
  const beat = (at: number, phase: FrameMark["phase"], state: Part): Beat => ({
    at: Math.max(from, at),
    mark: {
      ...(detail !== undefined && { detail }),
      kind: "call",
      phase,
      toolType: part.type,
    },
    parts: [state],
  });
  if (part.state !== "output-available" && part.state !== "output-error") {
    return [beat(from, "running", part)];
  }
  const { endedAt, startedAt } = part.metadata;
  // The cast is `toolPart`'s, in frames.ts.
  const early = (state: string, started?: Date) =>
    ({
      ...part,
      errorText: undefined,
      metadata: { ...part.metadata, endedAt: undefined, startedAt: started },
      output: undefined,
      state,
    }) as unknown as SessionMessagePart.ToolPart;
  const phase = part.state === "output-error" ? "failed" : "done";
  return [
    beat(from, "streaming", early("input-streaming")),
    beat(
      startedAt?.getTime() ?? from,
      "running",
      early("input-available", startedAt),
    ),
    beat(endedAt.getTime(), phase, part),
  ];
}

/** Words growing into what was stored, over their true span, as a scenario's do. */
function wordBeats(part: Extract<Part, { text: string }>, at: number): Beat[] {
  const kind = part.type === "text" ? "prose" : "reasoning";
  const end = Math.max(at, part.metadata.endedAt?.getTime() ?? at);
  const metadata = { ...part.metadata, endedAt: undefined };
  // About as fine as a provider streams, so the recorded pace has pieces to pace.
  const chunks = growingChunks(
    part.text,
    Math.max(6, Math.ceil(part.text.split(" ").length / 4)),
  );
  return [
    ...chunks.map((text, index) => ({
      at: at + ((end - at) * index) / chunks.length,
      mark: { kind, phase: "streaming" } as const,
      parts: [{ ...part, metadata, state: "streaming" as const, text }],
    })),
    { at: end, mark: { kind, phase: "done" }, parts: [part] },
  ];
}

/** Everything that happened to one stored message, in the order it happened. */
function beatsOf(message: Message): Beat[] {
  const at = message.metadata.createdAt.getTime();
  if (message.role !== "assistant") {
    const kind = message.role === "user" ? "user" : "context";
    const mark: FrameMark = { detail: message.role, kind };
    return [{ at, head: message, mark, parts: message.parts }];
  }
  const { error, finishReason, finishedAt } = message.metadata;
  const stopped = error?.kind === "aborted" ? "stopped" : "failed";
  const ended = finishReason === "max-steps" ? "capped" : "settled";
  const later = message.parts.filter((part) => part.type !== "step-start");
  return [
    {
      at,
      head: {
        ...message,
        metadata: {
          ...message.metadata,
          error: undefined,
          finishedAt: undefined,
          finishReason: "unknown",
        },
      },
      mark: { kind: later.length > 0 ? "pause" : "empty-step" },
      parts: message.parts.filter((part) => part.type === "step-start"),
    },
    ...later.flatMap((part): Beat[] => {
      const from = Math.max(at, part.metadata.createdAt.getTime());
      const mark: FrameMark = { detail: part.type, kind: "notes" };
      return isToolPart(part)
        ? callBeats(part, from)
        : part.type === "text" || part.type === "reasoning"
          ? wordBeats(part, from)
          : [{ at: from, mark, parts: [part] }];
    }),
    {
      at: finishedAt?.getTime() ?? at,
      head: message,
      ...(finishReason !== "tool-calls" && {
        mark: { kind: "turn", phase: error ? stopped : ended },
      }),
    },
  ];
}

/**
 * Every state a stored chat passed through, in the order its stamps give: the
 * stored messages as far as they had got, sharing what did not change.
 */
export function chatFrames(stored: readonly Message[]): Frame[] {
  const beats = stored
    .flatMap((message) =>
      beatsOf(message).map((beat) => ({ ...beat, message })),
    )
    .sort((a, b) => a.at - b.at);
  const shown = new Map<Message, Message>();
  const landed = new Map<StoreId.Part, Part>();
  const frames: Frame[] = [];
  for (const { at, head, mark, message, parts } of beats) {
    for (const part of parts ?? []) {
      landed.set(part.metadata.id, part);
    }
    shown.set(message, {
      ...(head ?? shown.get(message) ?? message),
      parts: message.parts.flatMap(
        (part) => landed.get(part.metadata.id) ?? [],
      ),
    });
    if (mark) {
      const messages = stored.flatMap((each) => shown.get(each) ?? []);
      const last = messages.at(-1);
      const isAgentRunning =
        last?.role !== "assistant" ||
        !last.metadata.finishedAt ||
        last.metadata.finishReason === "tool-calls";
      frames.push({ at, isAgentRunning, mark, messages });
    }
  }
  Object.assign(frames.at(-1) ?? {}, { isAgentRunning: false });
  return frames.slice(-MAX_FRAMES);
}

/** A message as of a frame, by the message it was, with every date moved by `by` ms. */
const shifted = new WeakMap<Message, { by: number; message: Message }>();

/**
 * A replayed frame's messages with their dates moved so the frame's own time
 * is now: a row that measures itself against the wall clock, such as Thinking,
 * then reads the time it read when the frame was recorded. A message that did
 * not change between frames stays the one object, so long as `by` does.
 */
export function messagesAsOfNow(
  messages: readonly Message[],
  by: number,
): Message[] {
  return messages.map((message) => {
    const known = shifted.get(message);
    if (known?.by === by) {
      return known.message;
    }
    // The cast is the walk's: it keeps every shape it is handed but a date's.
    const moved = movedDates(message, by) as Message;
    shifted.set(message, { by, message: moved });
    return moved;
  });
}

function movedDates(value: unknown, by: number): unknown {
  if (value instanceof Date) {
    return new Date(value.getTime() + by);
  }
  if (Array.isArray(value)) {
    return value.map((each: unknown) => movedDates(each, by));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, each]) => [key, movedDates(each, by)]),
    );
  }
  return value;
}
