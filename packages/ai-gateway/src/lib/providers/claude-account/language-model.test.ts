import { type LanguageModelV4Message } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { continuationOf, splitPrompt } from "./language-model";

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
    ).toBeUndefined();
  });

  it("starts over when tool results answer calls it was not waiting on", () => {
    const first = [system, user("one")];
    expect(
      continuation(after(first, ["t1"]), [
        ...first,
        callsTool("t2"),
        toolResult("t2"),
      ]),
    ).toBeUndefined();
  });

  it("starts over when the reply is missing", () => {
    const first = [system, user("one")];
    expect(continuation(after(first), [...first, user("two")])).toBeUndefined();
  });
});
