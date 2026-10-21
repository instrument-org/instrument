import {
  type DictationLanguage,
  type DictationStreamEvent,
  type DictationSurface,
} from "@/shared/dictation";
import { WebSocket } from "ws";
import { z } from "zod";

import { platformApiBaseUrl } from "./base-url";
import { dictationFailureOf } from "./dictation";
import { getPlatformApiHeaders } from "./headers";
import { getToken } from "./utils";

/** A stream that hasn't opened by now is treated as unavailable. */
const OPEN_TIMEOUT_MS = 5000;

/** What the API sends back over the socket. */
const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ final: z.boolean(), text: z.string(), type: z.literal("text") }),
  z.object({
    complete: z.boolean(),
    reason: z.enum(["allowance", "failed", "stopped"]),
    resetsAt: z.string().optional(),
    type: z.literal("end"),
  }),
]);

/** The open streams, by id, for the take's audio and its Stop to reach. */
const streams = new Map<
  string,
  { feed: (chunk: Blob) => void; finish: () => void }
>();

/**
 * Opens a live dictation stream to the API and reports what it hears, until
 * it ends or `signal` aborts, which closes it. The renderer cannot reach the
 * API itself, so the take's audio comes here through {@link feedDictation}
 * and its Stop through {@link finishDictation}, by the id `open` gives. Every
 * way it can fail comes back as an event, never a throw.
 */
export async function* listenForDictation({
  language,
  signal,
  surface,
}: {
  language?: DictationLanguage;
  signal?: AbortSignal;
  surface: DictationSurface;
}): AsyncGenerator<DictationStreamEvent> {
  if (!getToken()) {
    yield { failure: { kind: "signed-out" }, type: "unavailable" };
    return;
  }
  const base = platformApiBaseUrl().replace(/^http/, "ws");
  const query = language ? `?${new URLSearchParams({ language })}` : "";
  const socket = new WebSocket(`${base}/dictation/stream${query}`, {
    handshakeTimeout: OPEN_TIMEOUT_MS,
    headers: {
      ...getPlatformApiHeaders(),
      "x-instrument-dictation-surface": surface,
    },
  });

  // Events wait here until the generator is asked for the next one.
  const queue: DictationStreamEvent[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  const push = (event: DictationStreamEvent) => {
    queue.push(event);
    wake?.();
  };
  const end = () => {
    done = true;
    wake?.();
  };

  const id = crypto.randomUUID();
  let opened = false;
  let ended = false;
  // Audio goes out in the order it was recorded, each chunk read in turn. A
  // step that fails is dropped rather than stopping the ones after it, Stop
  // above all.
  let sending = Promise.resolve();
  const then = (step: () => Promise<void> | void) => {
    sending = sending.then(step).catch(() => undefined);
  };
  streams.set(id, {
    feed: (chunk) => {
      then(async () => {
        const bytes = Buffer.from(await chunk.arrayBuffer());
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(bytes);
        }
      });
    },
    finish: () => {
      then(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "stop" }));
        }
      });
    },
  });

  socket.on("unexpected-response", (_request, response) => {
    let body = "";
    response.on("data", (data: Buffer) => {
      body += data.toString();
    });
    response.on("end", () => {
      const failure = dictationFailureOf(response.statusCode ?? 0, body);
      push({ failure, type: "unavailable" });
      end();
    });
    response.on("error", () => {
      push({ failure: { kind: "server" }, type: "unavailable" });
      end();
    });
  });
  socket.on("open", () => {
    opened = true;
    push({ id, type: "open" });
  });
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(
        (Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : data
        ).toString(),
      );
    } catch {
      return;
    }
    const message = ServerMessageSchema.safeParse(json).data;
    if (!message) {
      return;
    }
    if (message.type === "end") {
      ended = true;
    }
    push(message);
  });
  socket.on("error", () => {
    // `close` follows, which says what this meant.
  });
  socket.on("close", () => {
    if (!opened) {
      if (!done) {
        push({ failure: { kind: "connection" }, type: "unavailable" });
      }
    } else if (!ended) {
      push({ type: "lost" });
    }
    end();
  });
  const abort = () => {
    socket.terminate();
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    while (true) {
      const event = queue.shift();
      if (event) {
        yield event;
        continue;
      }
      if (done || signal?.aborted) {
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    streams.delete(id);
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.terminate();
    }
  }
}

/** Sends the next stretch of a take's audio to its stream; gone streams ignore it. */
export function feedDictation(id: string, chunk: Blob) {
  streams.get(id)?.feed(chunk);
}

/** Tells a take's stream it has stopped, so it settles its last words and ends. */
export function finishDictation(id: string) {
  streams.get(id)?.finish();
}
