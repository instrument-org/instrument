import { type LanguageModelV4Message } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import {
  branchOf,
  coldStartReason,
  continuationOf,
  planStep,
  splitPrompt,
} from "./continuation";
import { type ResumeRecord } from "./resume-record";

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

  // The workspace asks for one more step after a finished reply with a note
  // it never stores: a link correction, the rest of a reply the output limit
  // cut off, the work a reply promised. Starting over for it replayed the
  // whole history and lost what Claude Code's own tools had found.
  it("continues a turn of only a note after the reply", () => {
    const first = [system, user("one")];
    expect(
      continuation(after(first), [
        ...first,
        reply("a"),
        notice("These links open nothing."),
      ]),
    ).toEqual({
      kind: "turn",
      messages: [notice("These links open nothing.")],
    });
  });

  // The note is not kept, so the request after it reads the history with the
  // corrected reply straight after the first one.
  it.each([
    {
      added: [user("two")],
      awaiting: [],
      expected: { kind: "turn", messages: [user("two")] },
      name: "a new message",
    },
    {
      added: [toolResult("t1")],
      awaiting: ["t1"],
      expected: {
        followedBy: [],
        kind: "tool-results",
        results: toolResult("t1").content,
      },
      name: "the results of a call the correction made",
    },
  ])(
    "continues after a note's turn with $name",
    ({ added, awaiting, expected }) => {
      const first = [system, user("one")];
      const noted = [...first, reply("a"), notice("fix the links")];
      const correction = awaiting.length > 0 ? callsTool("t1") : reply("fixed");
      expect(
        continuation(after(noted, awaiting), [
          ...first,
          reply("a"),
          correction,
          ...added,
        ]),
      ).toEqual(expected);
    },
  );

  it("starts over when nothing follows the reply", () => {
    const first = [system, user("one")];
    expect(continuation(after(first), [...first, reply("a")])).toEqual({
      kind: "restart",
      reason: "no tool results awaited, the reply is followed by none",
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

describe("planStep", () => {
  const chat = [system, user("one")];
  const answered = [...chat, reply("a"), user("two")];
  const record = (
    prompt: LanguageModelV4Message[],
    fields: Partial<ResumeRecord> = {},
  ): ResumeRecord => ({
    ...after(prompt),
    claudeSessionId: "transcript",
    ...fields,
  });
  const found = (value: ResumeRecord) => () =>
    Promise.resolve({ record: value });
  const none = () => Promise.resolve({ missing: "no resume record" });
  const noParent = () => Promise.resolve(undefined);
  const refuse = () => Promise.reject(new Error("read too far"));

  it("continues the live process without reading a record", async () => {
    const live = after(chat);
    await expect(
      planStep(
        { live, parentRecord: refuse, record: refuse },
        splitPrompt(answered),
      ),
    ).resolves.toEqual({
      continuation: { kind: "turn", messages: [user("two")] },
      kind: "live",
      session: live,
    });
  });

  it("starts cold, with the reason, when the live process cannot continue", async () => {
    const plan = await planStep(
      {
        live: after([system, user("edited")]),
        parentRecord: refuse,
        record: refuse,
      },
      splitPrompt(answered),
    );
    expect(plan).toMatchObject({
      kind: "cold",
      why: { detail: expect.stringContaining("changed"), tag: "restart" },
    });
  });

  it("resumes the session's transcript without reading its parent's", async () => {
    await expect(
      planStep(
        { live: undefined, parentRecord: refuse, record: found(record(chat)) },
        splitPrompt(answered),
      ),
    ).resolves.toEqual({
      claudeSessionId: "transcript",
      kind: "resume",
      messages: [user("two")],
    });
  });

  it("starts cold when the transcript it would resume waited on tool results", async () => {
    const calling = [...chat, callsTool("t1"), toolResult("t1")];
    await expect(
      planStep(
        {
          live: undefined,
          parentRecord: refuse,
          record: found(record(chat, { awaitingToolCallIds: ["t1"] })),
        },
        splitPrompt(calling),
      ),
    ).resolves.toEqual({
      kind: "cold",
      why: {
        detail: "its process ended while waiting on tool results",
        tag: "transcript",
      },
    });
  });

  it("forks the parent's transcript where it branched off", async () => {
    await expect(
      planStep(
        {
          live: undefined,
          parentRecord: found(
            record(chat, { claudeSessionId: "chat", forkPoint: "entry" }),
          ),
          record: none,
        },
        splitPrompt([...chat, user("the assignment")]),
      ),
    ).resolves.toEqual({
      at: "entry",
      from: "chat",
      kind: "fork",
      messages: [user("the assignment")],
    });
  });

  it.each([
    [
      "has no fork point",
      record(chat),
      "the parent's record has no fork point",
    ],
    [
      "saw other messages",
      record([system, user("other")], { forkPoint: "entry" }),
      "the request does not carry on from the input of the parent's last step (no resume record of its own)",
    ],
  ])(
    "starts cold, saying why, when the parent %s",
    async (_, parent, detail) => {
      await expect(
        planStep(
          { live: undefined, parentRecord: found(parent), record: none },
          splitPrompt([...chat, user("the assignment")]),
        ),
      ).resolves.toEqual({ kind: "cold", why: { detail, tag: "fork" } });
    },
  );

  it("starts cold, saying why, with nothing to carry on", async () => {
    await expect(
      planStep(
        { live: undefined, parentRecord: noParent, record: none },
        splitPrompt(answered),
      ),
    ).resolves.toEqual({
      kind: "cold",
      why: {
        detail: "no live process and no resume record",
        tag: "no-record",
      },
    });
  });
});

describe("coldStartReason", () => {
  const noRecord = {
    detail: "no live process and no resume record",
    tag: "no-record" as const,
  };
  const base = {
    busy: false,
    changedShape: undefined,
    kept: [system, user("one"), reply("a"), user("two")],
    oneOff: false,
    why: noRecord,
  };

  it.each([
    ["a one-off", { oneOff: true }],
    ["a session's first step", { kept: [system, user("one")] }],
  ])("says nothing for %s, which loses nothing", (_, fields) => {
    expect(coldStartReason({ ...base, ...fields })).toBeUndefined();
  });

  it.each([
    ["the plan's reason", {}, noRecord],
    [
      "a busy process",
      { busy: true },
      { detail: "its process is mid-step on another request", tag: "busy" },
    ],
    [
      "a changed shape, for a slot with nothing of its own",
      { changedShape: "system prompt and tools" },
      {
        detail:
          "the session's system prompt and tools changed since its last step, which needs a process of its own",
        tag: "shape",
      },
    ],
    [
      "the plan's reason over a changed shape, for a slot with a transcript",
      {
        changedShape: "tools",
        why: { detail: "message 1 of 2 (user) changed", tag: "transcript" },
      },
      { detail: "message 1 of 2 (user) changed", tag: "transcript" },
    ],
  ] as const)("names %s", (_, fields, expected) => {
    expect(coldStartReason({ ...base, ...fields })).toEqual(expected);
  });
});
