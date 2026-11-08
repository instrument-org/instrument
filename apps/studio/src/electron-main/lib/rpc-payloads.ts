import { alarms } from "@instrument-org/shared/alarms";

import { createScopedLogger } from "@/electron-main/lib/electron-logger";

/**
 * Sizes past which a procedure's traffic to a window is worth a warning. A
 * message's size is its frame's string length, which for the mostly ASCII
 * JSON oRPC sends is its size in bytes.
 */
const PAYLOAD_LIMITS = {
  /** One message this large is a procedure sending a whole thing at once. */
  messageBytes: 1_000_000,
  /** This much within a minute is a procedure sending the same thing over. */
  minuteBytes: 10_000_000,
  /**
   * More than `largeMessages` messages this large within a minute is a
   * procedure resending a whole collection on every change, which can stay
   * under `minuteBytes` while sending the same 400 KB again and again.
   */
  largeBytes: 256_000,
  largeMessages: 10,
  /**
   * More streams than this open from one procedure to one window is a
   * subscription made per row, link or tab rather than once.
   */
  procedureStreams: 50,
  /**
   * A window's open streams passing this, and then each doubling of it, is
   * streams that open and never end.
   */
  windowStreams: 200,
};

/** The rolling minute is six ten-second buckets, so a total costs six adds. */
const BUCKET_MS = 10_000;
const BUCKETS = 6;
/**
 * Calls a window can have waiting on an answer before the one idle longest is
 * forgotten, so the cap drops calls that ended without a frame saying so.
 * Streams are followed apart from these, so requests never push one out.
 */
const MAX_CALLS = 1_000;
/**
 * Streams a window can have open before the one opened first stops being
 * followed. Nothing said it ended, so it stays counted as open under its
 * procedure until the port closes, and what it sends later counts as
 * `(unknown)`. A window only gets here well past the stream warnings.
 */
const MAX_STREAMS = 4_000;
/** Procedures a window counts apart before the rest share one total. */
const MAX_PATHS = 500;
/** How much of a frame is read to find its id, type and path. */
const HEAD_CHARS = 512;

/** What a frame is counted under when its call is not known. */
const UNKNOWN = "(unknown)";
const OTHER = "(other)";

/**
 * The opening of an oRPC message-port frame, which `@orpc/standard-server-peer`
 * writes as JSON with the keys in this order: the call's id, its type when not
 * a request or response (3 an event of a stream, 4 an abort), then the
 * payload, which opens with the request's path or the event's kind.
 */
const FRAME_HEAD =
  /^\{"i":"([^"]{1,64})"(?:,"t":(\d))?(?:,"p":\{"(?:u":"([^"]{1,300})"|e":"(\w{1,16})"))?/;
const EVENT_STREAM = '"text/event-stream"';

type Frame = {
  id: string;
  type: number | undefined;
  /** The procedure a request calls, from its URL path. */
  path: string | undefined;
  /** An event's kind: `message`, `error` or `done`. */
  event: string | undefined;
  /** Whether a response opens a stream rather than answering the call. */
  opensStream: boolean;
};

/** Reads a frame's head, or nothing for a frame this does not know. */
export function readFrameHead(data: unknown): Frame | undefined {
  const head =
    typeof data === "string"
      ? data.slice(0, HEAD_CHARS)
      : data instanceof ArrayBuffer
        ? new TextDecoder().decode(
            new Uint8Array(data, 0, Math.min(HEAD_CHARS, data.byteLength)),
          )
        : undefined;
  if (head === undefined) {
    return undefined;
  }
  const match = FRAME_HEAD.exec(head);
  if (!match?.[1]) {
    return undefined;
  }
  const [, id, type, url, event] = match;
  return {
    id,
    type: type === undefined ? undefined : Number(type),
    path: url?.replace(/^\/+/, "").replaceAll("/", "."),
    event,
    opensStream: type === undefined && head.includes(EVENT_STREAM),
  };
}

/** A frame's size: its string length or its byte length, else nothing. */
function sizeOf(data: unknown) {
  if (typeof data === "string") {
    return data.length;
  }
  return data instanceof ArrayBuffer ? data.byteLength : 0;
}

/** A procedure's rolling minute: one bucket per ten seconds, by epoch. */
type Minute = {
  epoch: number;
  bytes: number;
  messages: number;
  /** Messages over `largeBytes`, and the largest of them. */
  large: number;
  largest: number;
}[];

type MeterOptions = {
  /** The window the port belongs to, named in each warning. */
  window: number;
  warn: (message: string) => void;
  now?: () => number;
  /**
   * The limit on warnings, shared by every window's meter, so each kind of
   * warning goes out at most once an hour per procedure.
   */
  gate?: Pick<typeof alarms, "raise">;
  limits?: typeof PAYLOAD_LIMITS;
};

/**
 * Counts what one window's RPC port sends, by procedure, and warns when one
 * message, one rolling minute of a procedure's messages, or how many large
 * messages it sent in that minute is past the limits, and when a procedure or
 * the window has too many streams open.
 * Observation only: every method swallows its own failures.
 */
export function createPayloadMeter({
  window,
  warn,
  now = Date.now,
  gate = alarms,
  limits = PAYLOAD_LIMITS,
}: MeterOptions) {
  /** Calls waiting on an answer by id, the one idle longest first. */
  const calls = new Map<string, string>();
  /** Open streams by id, the one opened first first. */
  const streams = new Map<string, string>();
  /** Open streams per procedure, counting those past `MAX_STREAMS`. */
  const openByPath = new Map<string, number>();
  let openTotal = 0;
  let nextWindowLevel = limits.windowStreams;
  const traffic = new Map<string, Minute>();

  const mostOpen = () =>
    [...openByPath]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([path, open]) => `${path} ${open}`)
      .join(", ");

  const openStream = (id: string, path: string) => {
    streams.set(id, path);
    if (streams.size > MAX_STREAMS) {
      const first = streams.keys().next();
      if (!first.done) {
        streams.delete(first.value);
      }
    }
    const open = (openByPath.get(path) ?? 0) + 1;
    openByPath.set(path, open);
    openTotal += 1;
    const total = openTotal;
    if (open > limits.procedureStreams) {
      gate.raise(
        `rpc:streams:${path}`,
        () =>
          `RPC streams: ${path} has ${open} streams open to window ${window} (${total} open in all)`,
        warn,
      );
    }
    if (total > nextWindowLevel) {
      const level = nextWindowLevel;
      nextWindowLevel *= 2;
      gate.raise(
        `rpc:window-streams:${window}:${level}`,
        () =>
          `RPC streams: window ${window} has ${total} streams open, past ${level} (most: ${mostOpen()})`,
        warn,
      );
    }
  };

  const endStream = (id: string) => {
    const path = streams.get(id);
    if (path === undefined) {
      return;
    }
    streams.delete(id);
    const open = (openByPath.get(path) ?? 1) - 1;
    if (open > 0) {
      openByPath.set(path, open);
    } else {
      openByPath.delete(path);
    }
    openTotal -= 1;
  };

  const minuteOf = (named: string) => {
    const path = traffic.has(named) || traffic.size < MAX_PATHS ? named : OTHER;
    const known = traffic.get(path);
    if (known) {
      return known;
    }
    const fresh: Minute = Array.from({ length: BUCKETS }, () => ({
      epoch: -1,
      bytes: 0,
      messages: 0,
      large: 0,
      largest: 0,
    }));
    traffic.set(path, fresh);
    return fresh;
  };

  const count = (path: string, bytes: number, at: number) => {
    const minute = minuteOf(path);
    const epoch = Math.floor(at / BUCKET_MS);
    const bucket = minute[epoch % BUCKETS];
    if (bucket && bucket.epoch !== epoch) {
      bucket.epoch = epoch;
      bucket.bytes = 0;
      bucket.messages = 0;
      bucket.large = 0;
      bucket.largest = 0;
    }
    if (bucket) {
      bucket.bytes += bytes;
      bucket.messages += 1;
      if (bytes > limits.largeBytes) {
        bucket.large += 1;
        bucket.largest = Math.max(bucket.largest, bytes);
      }
    }
    let total = 0;
    let messages = 0;
    let large = 0;
    let largest = 0;
    for (const each of minute) {
      if (each.epoch > epoch - BUCKETS) {
        total += each.bytes;
        messages += each.messages;
        large += each.large;
        largest = Math.max(largest, each.largest);
      }
    }
    return { total, messages, large, largest };
  };

  return {
    /** Notes the procedure a request from the window calls, by its id. */
    received(data: unknown) {
      try {
        const frame = readFrameHead(data);
        if (!frame) {
          return;
        }
        if (frame.type === 4) {
          calls.delete(frame.id);
          endStream(frame.id);
          return;
        }
        if (frame.type === undefined && frame.path) {
          calls.delete(frame.id);
          endStream(frame.id);
          calls.set(frame.id, frame.path);
          if (calls.size > MAX_CALLS) {
            const idlest = calls.keys().next();
            if (!idlest.done) {
              calls.delete(idlest.value);
            }
          }
        }
      } catch {
        // A frame this cannot read costs the count, not the call.
      }
    },

    /** Counts a message sent to the window, and warns past a limit. */
    sent(data: unknown) {
      try {
        const bytes = sizeOf(data);
        const frame = readFrameHead(data);
        let path = UNKNOWN;
        if (frame) {
          const ends =
            frame.type === 4 ||
            (frame.type === 3 && frame.event !== "message") ||
            (frame.type === undefined && !frame.opensStream);
          const stream = streams.get(frame.id);
          const call = calls.get(frame.id);
          if (stream !== undefined) {
            path = stream;
            if (ends) {
              endStream(frame.id);
            }
          } else if (call !== undefined) {
            path = call;
            calls.delete(frame.id);
            if (frame.type === undefined && frame.opensStream) {
              openStream(frame.id, call);
            } else if (!ends) {
              calls.set(frame.id, call);
            }
          }
        }
        const at = now();
        const { total, messages, large, largest } = count(path, bytes, at);
        if (bytes > limits.messageBytes) {
          gate.raise(
            `rpc:message:${path}`,
            () =>
              `RPC payload: ${path} sent ${megabytes(bytes)} in one message to window ${window} (${messages} ${messages === 1 ? "message" : "messages"}, ${megabytes(total)} in the last minute)`,
            warn,
          );
        }
        if (total > limits.minuteBytes) {
          gate.raise(
            `rpc:minute:${path}`,
            () =>
              `RPC payload: ${path} sent ${megabytes(total)} in ${messages} messages to window ${window} within a minute`,
            warn,
          );
        }
        if (bytes > limits.largeBytes && large > limits.largeMessages) {
          gate.raise(
            `rpc:large:${path}`,
            () =>
              `RPC payload: ${path} sent ${large} messages over ${kilobytes(limits.largeBytes)} to window ${window} within a minute (largest ${kilobytes(largest)})`,
            warn,
          );
        }
      } catch {
        // Counting never gets in the way of the message, which has gone.
      }
    },

    /** How many calls and streams the meter is following, for tests. */
    openCalls: () => calls.size + streams.size,

    /** How many streams are open, for tests. */
    openStreams: () => openTotal,

    /** Forgets the window's calls and counts once its port closes. */
    closed() {
      calls.clear();
      streams.clear();
      openByPath.clear();
      openTotal = 0;
      nextWindowLevel = limits.windowStreams;
      traffic.clear();
    },
  };
}

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function kilobytes(bytes: number) {
  return `${Math.round(bytes / 1_000)} KB`;
}

/** The part of Electron's `MessagePortMain` the meter uses. */
type RPCPort = {
  postMessage(message: unknown, transfer?: never): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
};

const log = createScopedLogger("rpc");

/**
 * Meters what the RPC router sends a window over its port, for the "RPC
 * payload" warnings. Call before the router takes the port. Each message is
 * handed to the port first and counted after, so counting can neither hold
 * one back nor change it.
 */
export function meterRPCPayloads(
  port: RPCPort,
  window: number,
  options: Omit<MeterOptions, "window" | "warn"> & {
    warn?: (message: string) => void;
  } = {},
) {
  const meter = createPayloadMeter({
    window,
    ...options,
    warn: options.warn ?? ((message) => log.warn(message)),
  });
  const post = port.postMessage.bind(port);
  port.postMessage = (...args) => {
    post(...args);
    try {
      meter.sent(args[0]);
    } catch {
      // `sent` catches its own; this is for a meter that one day does not.
    }
  };
  port.on("message", (event) => {
    meter.received(event?.data);
  });
  port.on("close", () => {
    meter.closed();
  });
  return meter;
}
