import { createScopedLogger } from "@/electron-main/lib/electron-logger";

/**
 * Sizes past which a procedure's traffic to a window is worth a warning. A
 * message's size is its frame's string length, which for the mostly ASCII
 * JSON oRPC sends is its size in bytes.
 */
export const PAYLOAD_LIMITS = {
  /** One message this large is a procedure sending a whole thing at once. */
  messageBytes: 1_000_000,
  /** This much within a minute is a procedure sending the same thing over. */
  minuteBytes: 10_000_000,
};

/** The rolling minute is six ten-second buckets, so a total costs six adds. */
const BUCKET_MS = 10_000;
const BUCKETS = 6;
/** One warning of each kind per procedure per hour, across every window. */
const WARN_EVERY_MS = 60 * 60_000;
/**
 * Calls a window can have open before the one idle longest is forgotten. A
 * stream counts as open until it ends, and is moved to the back each time it
 * sends, so the cap drops calls that ended without a frame saying so.
 */
const MAX_CALLS = 1_000;
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
type Minute = { epoch: number; bytes: number; messages: number }[];

/**
 * Remembers when each kind of warning last went out per procedure, shared by
 * every window's meter so the log has at most one line of each per hour.
 */
export function createWarningGate(everyMs = WARN_EVERY_MS) {
  const last = new Map<string, number>();
  return (key: string, now: number) => {
    const at = last.get(key);
    if (at !== undefined && now - at < everyMs) {
      return false;
    }
    // Keys are a kind and a procedure, so this only trips on a renderer
    // making up paths; forgetting them all then costs a repeat warning.
    if (last.size >= MAX_PATHS * 2) {
      last.clear();
    }
    last.set(key, now);
    return true;
  };
}

const processGate = createWarningGate();

type MeterOptions = {
  /** The window the port belongs to, named in each warning. */
  window: number;
  warn: (message: string) => void;
  now?: () => number;
  allowWarning?: (key: string, now: number) => boolean;
  limits?: typeof PAYLOAD_LIMITS;
};

/**
 * Counts what one window's RPC port sends, by procedure, and warns when one
 * message or one rolling minute of a procedure's messages is past the limits.
 * Observation only: every method swallows its own failures.
 */
export function createPayloadMeter({
  window,
  warn,
  now = Date.now,
  allowWarning = processGate,
  limits = PAYLOAD_LIMITS,
}: MeterOptions) {
  /** Open calls by id, the one idle longest first. */
  const calls = new Map<string, string>();
  const traffic = new Map<string, Minute>();

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
    }
    if (bucket) {
      bucket.bytes += bytes;
      bucket.messages += 1;
    }
    let total = 0;
    let messages = 0;
    for (const each of minute) {
      if (each.epoch > epoch - BUCKETS) {
        total += each.bytes;
        messages += each.messages;
      }
    }
    return { total, messages };
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
          return;
        }
        if (frame.type === undefined && frame.path) {
          calls.delete(frame.id);
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
        const path = (frame && calls.get(frame.id)) ?? UNKNOWN;
        if (frame && path !== UNKNOWN) {
          const ends =
            frame.type === 4 ||
            (frame.type === 3 && frame.event !== "message") ||
            (frame.type === undefined && !frame.opensStream);
          calls.delete(frame.id);
          if (!ends) {
            calls.set(frame.id, path);
          }
        }
        const at = now();
        const { total, messages } = count(path, bytes, at);
        const lastMinute = `${messages} ${messages === 1 ? "message" : "messages"}, ${megabytes(total)} in the last minute`;
        if (
          bytes > limits.messageBytes &&
          allowWarning(`message:${path}`, at)
        ) {
          warn(
            `RPC payload: ${path} sent ${megabytes(bytes)} in one message to window ${window} (${lastMinute})`,
          );
        }
        if (total > limits.minuteBytes && allowWarning(`minute:${path}`, at)) {
          warn(
            `RPC payload: ${path} sent ${megabytes(total)} in ${messages} messages to window ${window} within a minute`,
          );
        }
      } catch {
        // Counting never gets in the way of the message, which has gone.
      }
    },

    /** How many calls the meter is following, for tests. */
    openCalls: () => calls.size,

    /** Forgets the window's calls and counts once its port closes. */
    closed() {
      calls.clear();
      traffic.clear();
    },
  };
}

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
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
