import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, timingSafeEqual } from "node:crypto";
import net from "node:net";
import { z } from "zod";

import { type CapabilityScope, capabilityContexts } from "./context";
import { type CapabilityErrorReply } from "./define";
import {
  type DescribedCapability,
  describeCapabilities,
  dispatch,
} from "./dispatch";

/**
 * The variable that tells a script's `instrument` where its channel
 * listens: `<port>:<token>` on 127.0.0.1. Taken out of the environment
 * before the script's own code runs, so a process the script starts gets
 * neither.
 */
export const SCRIPT_CHANNEL_ENV = "INSTRUMENT_CHANNEL";

/** What a script asks over its channel: what it may call, or one call. */
export type ChannelRequest =
  | { args: unknown; capability: string; kind: "call" }
  | { kind: "describe" };

/** The answer to one request, sent back on the line with its id. */
export type ChannelReply =
  | { capabilities: DescribedCapability[] }
  | { error: CapabilityErrorReply }
  | { result: unknown };

/** What answers a script's requests, under the signal of the command that started it. */
export type ChannelAnswer = (
  request: ChannelRequest,
  signal: AbortSignal | undefined,
) => Promise<ChannelReply>;

/**
 * The answer for a bash call's scripts: the registry's dispatcher, with the
 * call's chat, session, model and role, which a script never names.
 */
export function answerChannel(scope: CapabilityScope): ChannelAnswer {
  const contextFor = capabilityContexts(scope, "script");
  return async (request, signal) => {
    const ctx = contextFor(signal);
    if (request.kind === "describe") {
      return { capabilities: describeCapabilities(ctx) };
    }
    const answer = await dispatch(request.capability, request.args, ctx);
    return "error" in answer
      ? { error: answer.error }
      : { result: answer.output };
  };
}

/** One request line a script's runtime sends. */
const RequestLineSchema = z.union([
  z.object({ describe: z.literal(true), id: z.number() }),
  z.object({ args: z.unknown(), capability: z.string(), id: z.number() }),
]);

/** Longest a connection may write before giving its token. */
const TOKEN_LINE_LIMIT = 256;

/**
 * Where one native process calls `instrument`: a listener on 127.0.0.1 that
 * takes a connection only once its first line is the token, then answers
 * each request line with `answer`. The token opens exactly what the shell's
 * own `instrument` opens in the same bash call.
 */
export interface ScriptChannel {
  /** The variable to start the process with. */
  env: Record<string, string>;
  /**
   * The signal calls run under from now on: a stage handing its stdout on
   * outlives the command that started it.
   */
  attach(signal: AbortSignal): void;
  /** Stops listening and drops every connection, once the process is gone. */
  close(): void;
}

/**
 * Opens a channel for one process. Each request is answered in the async
 * context the channel was opened in, the bash call's, so what a call leaves
 * on the call (a guide handed over, a card raised) reaches its result.
 */
export async function openScriptChannel(
  answer: ChannelAnswer,
): Promise<ScriptChannel> {
  const inContext = AsyncLocalStorage.snapshot();
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(token);
  const sockets = new Set<net.Socket>();
  let signal: AbortSignal | undefined;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setNoDelay(true);
    let opened = false;
    let received = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      for (
        let end = received.indexOf(10);
        end !== -1;
        end = received.indexOf(10)
      ) {
        const line = received.subarray(0, end);
        received = received.subarray(end + 1);
        if (!opened) {
          if (
            line.length !== expected.length ||
            !timingSafeEqual(line, expected)
          ) {
            socket.destroy();
            return;
          }
          opened = true;
          continue;
        }
        let parsed: z.output<typeof RequestLineSchema>;
        try {
          parsed = RequestLineSchema.parse(JSON.parse(line.toString("utf8")));
        } catch {
          socket.destroy();
          return;
        }
        const { id } = parsed;
        const request: ChannelRequest =
          "describe" in parsed
            ? { kind: "describe" }
            : {
                args: parsed.args,
                capability: parsed.capability,
                kind: "call",
              };
        void inContext(() => answer(request, signal))
          .catch(
            (error: unknown): ChannelReply => ({
              error: {
                kind: "failed",
                message: error instanceof Error ? error.message : String(error),
              },
            }),
          )
          .then((reply) => {
            if (!socket.destroyed) {
              socket.write(`${JSON.stringify({ id, ...reply })}\n`);
            }
          });
      }
      if (!opened && received.length > TOKEN_LINE_LIMIT) {
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    attach(next) {
      signal = next;
    },
    close() {
      server.close();
      for (const socket of sockets) {
        socket.destroy();
      }
    },
    env: { [SCRIPT_CHANNEL_ENV]: `${port}:${token}` },
  };
}
