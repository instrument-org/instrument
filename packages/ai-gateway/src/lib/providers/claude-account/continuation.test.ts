import { type LanguageModelV4Message } from "@ai-sdk/provider";
import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import {
  branchOf,
  continuationOf,
  endTurnOnResults,
  splitPrompt,
} from "./language-model";

const system: LanguageModelV4Message = {
  content: "You are Pebble.",
  role: "system",
};
const user = (text: string): LanguageModelV4Message => ({
  content: [{ text, type: "text" }],
  role: "user",
});
const notice = (text: string): LanguageModelV4Message => ({
  ...user(text),
  providerOptions: { instrument: { transient: true } },
});
const reply = (text: string): LanguageModelV4Message => ({
  content: [{ text, type: "text" }],
  role: "assistant",
});
const callsTool = (id: string): LanguageModelV4Message => ({
  content: [{ input: {}, toolCallId: id, toolName: "bash", type: "tool-call" }],
  role: "assistant",
});
const toolResult = (id: string): LanguageModelV4Message => ({
  content: [
    {
      output: { type: "text", value: "ok" },
      toolCallId: id,
      toolName: "bash",
      type: "tool-result",
    },
  ],
  role: "tool",
});

/** The process as it stands after answering `prompt`. */
function after(
  prompt: LanguageModelV4Message[],
  awaitingToolCallIds: string[] = [],
) {
  return { awaitingToolCallIds, seen: splitPrompt(prompt).keptPrints };
}

function continuation(
  session: ReturnType<typeof after>,
  prompt: LanguageModelV4Message[],
) {
  const { kept, keptPrints, transient } = splitPrompt(prompt);
  return continuationOf(session, kept, keptPrints, transient);
}

describe("continuationOf", () => {
  // A step that hands work off ends the turn on its tool call, and the
  // message saying the work finished arrives after the results.
  it("continues with tool results and what was said after them", () => {
    const first = [system, user("one")];
    expect(
      continuation(after(first, ["t1"]), [
        ...first,
        callsTool("t1"),
        toolResult("t1"),
        user("the task finished"),
      ]),
    ).toEqual({
      kind: "tool-results",
      results: toolResult("t1").content,
      followedBy: [user("the task finished")],
    });
  });

  it("names what followed the reply when tool results were awaited", () => {
    const first = [system, user("one")];
    expect(
      continuation(after(first, ["t1"]), [
        ...first,
        callsTool("t1"),
        reply("never ran it"),
      ]),
    ).toEqual({
      kind: "restart",
      reason: "awaiting 1 tool results, the reply is followed by assistant",
    });
  });

  it("continues a new turn with only the new message", () => {
    const first = [system, user("one")];
    expect(
      continuation(after(first), [...first, reply("a"), user("two")]),
    ).toEqual({ kind: "turn", messages: [user("two")] });
  });

  it("sends the new message, not just the notice, once a notice rides every request", () => {
    const first = [system, user("one"), notice("80% of context used")];
    const next = [
      system,
      user("one"),
      reply("a"),
      user("two"),
      notice("85% of context used"),
    ];
    expect(continuation(after(first), next)).toEqual({
      kind: "turn",
      messages: [user("two"), notice("85% of context used")],
    });
  });

  it("continues with tool results while a notice rides along", () => {
    const first = [system, user("one"), notice("80%")];
    const next = [
      system,
      user("one"),
      callsTool("t1"),
      toolResult("t1"),
      notice("81%"),
    ];
    expect(continuation(after(first, ["t1"]), next)).toMatchObject({
      kind: "tool-results",
    });
  });

  // Our loop marks a cache breakpoint on the last part of the newest two
  // messages, so the breakpoint a message carried last step is gone from it
  // this step. Reading that as a changed message restarted the process on
  // every step, from a replay that dropped images and the cached prefix.
  it("continues when a cache breakpoint moved off a part it had seen", () => {
    const marked = (message: LanguageModelV4Message): LanguageModelV4Message =>
      message.role === "user"
        ? {
            ...message,
            content: message.content.map((part) => ({
              ...part,
              providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral" } },
              },
            })),
          }
        : message;
    const first = [system, marked(user("one"))];
    expect(
      continuation(after(first, ["t1"]), [
        system,
        user("one"),
        callsTool("t1"),
        toolResult("t1"),
      ]),
    ).toMatchObject({ kind: "tool-results" });
  });

  it("starts over when an earlier message changed", () => {
    const first = [system, user("one")];
    expect(
      continuation(after(first), [
        system,
        user("edited"),
        reply("a"),
        user("two"),
      ]),
    ).toEqual({
      kind: "restart",
      reason: "message 1 of 2 (user) changed since the process saw it",
    });
  });

  it("starts over when tool results answer calls it was not waiting on", () => {
    const first = [system, user("one")];
    expect(
      continuation(after(first, ["t1"]), [
        ...first,
        callsTool("t2"),
        toolResult("t2"),
      ]),
    ).toEqual({
      kind: "restart",
      reason: "results answer 1 calls and leave 1 of 1 unanswered",
    });
  });

  it("starts over when the reply is missing", () => {
    const first = [system, user("one")];
    expect(continuation(after(first), [...first, user("two")])).toEqual({
      kind: "restart",
      reason: "message 2 is user, not the reply",
    });
  });
});

describe("branchOf", () => {
  const branch = (
    parent: ReturnType<typeof after>,
    prompt: LanguageModelV4Message[],
  ) => {
    const { kept, keptPrints, transient } = splitPrompt(prompt);
    return branchOf(parent, kept, keptPrints, transient);
  };

  // A task's history is its chat's up to the step that started it, then its
  // assignment: what that step was sent, without the reply it gave.
  it("branches with the new messages after everything the parent saw", () => {
    const chat = [system, user("one")];
    expect(
      branch(after(chat, ["t1"]), [...chat, user("the assignment")]),
    ).toEqual([user("the assignment")]);
  });

  it("does not branch from a parent whose messages changed", () => {
    expect(
      branch(after([system, user("one")]), [
        system,
        user("edited"),
        user("the assignment"),
      ]),
    ).toBeUndefined();
  });

  it("does not branch past a reply the parent never saw", () => {
    const chat = [system, user("one")];
    expect(
      branch(after(chat), [...chat, reply("a"), user("the assignment")]),
    ).toBeUndefined();
  });
});

describe("endTurnOnResults", () => {
  /** A session whose CLI reports `messages`, ending its turn on the results. */
  function session(messages: Partial<SDKMessage>[]) {
    const queue = [...messages];
    return {
      endTurnAfterTools: true,
      messages: {
        next: () => {
          const value = queue.shift();
          return Promise.resolve(
            value === undefined
              ? { done: true as const, value: undefined }
              : // Only the fields the reader looks at.
                { done: false as const, value: value as SDKMessage },
          );
        },
      },
      rateLimit: undefined,
      stderr: "",
    };
  }

  it("returns once the turn ends on the results, and stops ending turns there", async () => {
    const ending = session([
      { type: "user" },
      { is_error: false, subtype: "success", type: "result" },
    ]);
    await endTurnOnResults(ending);
    expect(ending.endTurnAfterTools).toBe(false);
  });

  it("fails the step when the model is asked about the results first", async () => {
    const replying = session([{ type: "user" }, { type: "stream_event" }]);
    await expect(endTurnOnResults(replying)).rejects.toThrow(
      /before the message that came after them/,
    );
    expect(replying.endTurnAfterTools).toBe(false);
  });
});
