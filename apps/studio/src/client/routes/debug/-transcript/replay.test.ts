import {
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  StoreId,
  transcriptMessage,
  turnsOf,
} from "@instrument-org/workspace/client";
import { MutationObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { buildFrames, type Frame } from "./frames";
import { chatFrames, lastTurns, readOnlyClient } from "./replay";
import { scenarios } from "./scenarios";
import { user } from "./script";

type Message = SessionMessage.WithParts;
type Part = SessionMessagePart.Type;

const T0 = 1_750_000_000_000;
const SESSION = StoreId.newSessionId();
const at = (seconds: number) => new Date(T0 + seconds * 1000);

function userMessage(seconds: number, text: string): Message {
  const id = StoreId.newMessageId();
  const metadata = {
    createdAt: at(seconds),
    id: StoreId.newPartId(),
    messageId: id,
    sessionId: SESSION,
  };
  return {
    id,
    metadata: { createdAt: at(seconds), sessionId: SESSION },
    parts: [{ metadata, state: "done", text, type: "text" }],
    role: "user",
  };
}

/** A step of the agent's, with a stamp in seconds on each thing it did. */
function step(
  seconds: number,
  finishedSeconds: number,
  finishReason: "stop" | "tool-calls",
  ...parts: ((messageId: StoreId.Message) => Part)[]
): Message {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt: at(seconds),
      finishedAt: at(finishedSeconds),
      finishReason,
      modelId: "claude-sonnet-5",
      providerId: "anthropic",
      sessionId: SESSION,
    } satisfies SessionMessage.AssistantWithParts["metadata"],
    parts: [
      {
        metadata: {
          createdAt: at(seconds),
          id: StoreId.newPartId(),
          messageId: id,
          sessionId: SESSION,
          stepCount: 0,
        },
        type: "step-start",
      },
      ...parts.map((part) => part(id)),
    ],
    role: "assistant",
  };
}

const words =
  (seconds: number, ended: number, text: string) =>
  (messageId: StoreId.Message): Part => ({
    metadata: {
      createdAt: at(seconds),
      endedAt: at(ended),
      id: StoreId.newPartId(),
      messageId,
      sessionId: SESSION,
    },
    state: "done",
    text,
    type: "text",
  });

const readCall =
  (seconds: number, started: number, ended: number) =>
  (messageId: StoreId.Message): Part =>
    ({
      input: { explanation: "Reading it", filePath: "./a.csv" },
      metadata: {
        createdAt: at(seconds),
        endedAt: at(ended),
        id: StoreId.newPartId(),
        messageId,
        sessionId: SESSION,
        startedAt: at(started),
      },
      output: { contents: "a,b" },
      state: "output-available",
      toolCallId: StoreId.ToolCallSchema.parse(`call_${seconds.toString()}`),
      type: "tool-read",
      // Whatever a read returned does not matter here, only when it did.
    }) as unknown as Part;

const summary =
  (seconds: number) =>
  (messageId: StoreId.Message): Part => ({
    data: { words: "Read the file" },
    metadata: {
      createdAt: at(seconds),
      id: StoreId.newPartId(),
      messageId,
      sessionId: SESSION,
    },
    type: "data-workSummary",
  });

/** Each frame as what it is, then the state of every part in order. */
function draw(frames: Frame[]): string {
  return frames
    .map((frame) => {
      const parts = frame.messages.flatMap((message) =>
        message.parts
          .filter((part) => part.type !== "step-start")
          .map((part) => {
            if (!isToolPart(part)) {
              return part.type === "text" || part.type === "reasoning"
                ? `${part.type}:${part.state ?? "done"}`
                : part.type;
            }
            return part.state === "input-available" && part.metadata.startedAt
              ? "running"
              : part.state.replace("output-", "");
          }),
      );
      const mark = `${frame.mark.kind}${frame.mark.phase === undefined ? "" : `:${frame.mark.phase}`}`;
      const live = frame.isAgentRunning ? "live" : "idle";
      return `${mark.padEnd(16)} ${live} ${parts.join(" ")}`;
    })
    .join("\n");
}

const ORDER = [
  "input-streaming",
  "input-available",
  "output-available",
  "output-error",
];

/** Why a frame is not the stored chat as far as it had got, if it is not. */
function prefixProblem(frame: Frame, stored: readonly Message[]) {
  const ids = stored.map((message) => message.id);
  let after = -1;
  for (const message of frame.messages) {
    const index = ids.indexOf(message.id);
    if (index <= after) {
      return `message ${message.id} out of order`;
    }
    after = index;
    const parts = stored[index]?.parts ?? [];
    let partAfter = -1;
    for (const part of message.parts) {
      const place = parts.findIndex(
        (each) => each.metadata.id === part.metadata.id,
      );
      const whole = parts[place];
      if (place <= partAfter || !whole) {
        return `part ${part.metadata.id} out of order`;
      }
      partAfter = place;
      if (
        "text" in part &&
        "text" in whole &&
        !whole.text.startsWith(part.text)
      ) {
        return `part ${part.metadata.id} has words it never had`;
      }
      if (
        isToolPart(part) &&
        isToolPart(whole) &&
        ORDER.indexOf(part.state) > ORDER.indexOf(whole.state)
      ) {
        return `part ${part.metadata.id} went past what was stored`;
      }
    }
  }
  return undefined;
}

const partsAt = (frame: Frame | undefined) =>
  new Set(
    frame?.messages.flatMap((message) =>
      message.parts.map((part) => part.metadata.id),
    ),
  );

describe("chatFrames", () => {
  describe.each(scenarios.map((each) => [each.name, each] as const))(
    "on what %s stores",
    (_name, scenario) => {
      const stored = buildFrames(scenario.script, T0).at(-1)?.messages ?? [];
      const frames = chatFrames(stored);

      it("ends on the chat as stored, with the agent at rest", () => {
        expect(frames.at(-1)?.messages).toEqual(stored);
        expect(frames.at(-1)?.isAgentRunning).toBe(false);
      });

      it("only ever shows a prefix, and never takes a part back", () => {
        for (const [index, frame] of frames.entries()) {
          expect(prefixProblem(frame, stored)).toBeUndefined();
          const now = partsAt(frame);
          const before = [...partsAt(frames[index - 1])];
          expect(before.filter((id) => !now.has(id))).toEqual([]);
        }
      });

      it("draws every frame without throwing", () => {
        for (const frame of frames) {
          const light = frame.messages.flatMap(
            (message) =>
              transcriptMessage(message, { isDeveloperMode: true }) ?? [],
          );
          const isRunning = frame.isAgentRunning;
          expect(() =>
            turnsOf(light, { isDeveloperMode: true, isRunning }),
          ).not.toThrow();
        }
      });
    },
  );

  it("walks a turn in the order its stamps give", () => {
    expect(
      draw(
        chatFrames([
          userMessage(0, "read it"),
          step(1, 2, "tool-calls", readCall(1, 2, 5)),
          step(6, 7, "stop", words(6, 7, "It says a and b."), summary(9)),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      "user             live text:done
      pause            live text:done
      call:streaming   live text:done input-streaming
      call:running     live text:done running
      call:done        live text:done available
      pause            live text:done available
      prose:streaming  live text:done available text:streaming
      prose:done       live text:done available text:done
      turn:settled     idle text:done available text:done
      notes            idle text:done available text:done data-workSummary"
    `);
  });

  it("holds back what a step finished on until it finished", () => {
    const stored = [
      userMessage(0, "go"),
      step(1, 5, "stop", words(2, 5, "Done.")),
    ];
    const reply = (frame: Frame | undefined) => frame?.messages[1]?.metadata;
    const frames = chatFrames(stored);
    const writing = frames.find((frame) => frame.mark.kind === "prose");

    expect(reply(writing)).toHaveProperty("finishedAt", undefined);
    expect(reply(writing)).toHaveProperty("finishReason", "unknown");
    expect(reply(frames.at(-1))).toHaveProperty("finishReason", "stop");
  });

  it("keeps the agent working through a message sent during a step", () => {
    const frames = chatFrames([
      userMessage(0, "go"),
      step(1, 2, "tool-calls", readCall(1, 2, 8)),
      userMessage(5, "also this"),
      step(9, 10, "stop", words(9, 10, "Both done.")),
    ]);

    expect(frames.map((frame) => frame.isAgentRunning)).toEqual([
      ...frames.slice(0, -1).map(() => true),
      false,
    ]);
  });

  it("settles a message nothing ever answered", () => {
    const frames = chatFrames(
      buildFrames([user("hello?")]).at(-1)?.messages ?? [],
    );

    expect(frames.at(-1)?.isAgentRunning).toBe(false);
  });

  it("leaves what did not change the same object", () => {
    const frames = chatFrames([
      userMessage(0, "go"),
      step(1, 2, "stop", words(1, 2, "Done.")),
    ]);

    expect(frames.at(-1)?.messages[0]).toBe(frames[0]?.messages[0]);
  });
});

describe("lastTurns", () => {
  const chat = [
    userMessage(0, "one"),
    step(1, 2, "stop", words(1, 2, "One.")),
    userMessage(3, "two"),
    step(4, 5, "stop", words(4, 5, "Two.")),
    userMessage(6, "three"),
    step(7, 8, "stop", words(7, 8, "Three.")),
  ];

  it.each([
    [1, 2],
    [2, 4],
    [3, 6],
    [9, 6],
  ])("keeps the last %i turns as %i messages", (count, messages) => {
    expect(lastTurns(chat, count)).toHaveLength(messages);
  });
});

describe("readOnlyClient", () => {
  it("stops a mutation before it reaches the app", async () => {
    const send = vi.fn(() => Promise.resolve());
    const observer = new MutationObserver(readOnlyClient, {
      mutationFn: send,
    });

    await expect(observer.mutate()).rejects.toThrow("read-only");
    expect(send).not.toHaveBeenCalled();
  });
});
