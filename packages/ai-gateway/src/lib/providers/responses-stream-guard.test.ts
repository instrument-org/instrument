import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  guardResponsesStream,
  type StreamEndedEarly,
} from "./responses-stream-guard";

type Event = Record<string, unknown> & { type: string };

const created: Event = {
  response: {
    created_at: 1,
    id: "resp_1",
    model: "gpt-5.6-sol",
    output: [],
    status: "in_progress",
  },
  sequence_number: 0,
  type: "response.created",
};
const inProgress: Event = {
  ...created,
  sequence_number: 1,
  type: "response.in_progress",
};
const messageAdded: Event = {
  item: {
    content: [],
    id: "msg_1",
    role: "assistant",
    status: "in_progress",
    type: "message",
  },
  output_index: 0,
  sequence_number: 2,
  type: "response.output_item.added",
};
const textDelta: Event = {
  content_index: 0,
  delta: "Hello",
  item_id: "msg_1",
  output_index: 0,
  sequence_number: 3,
  type: "response.output_text.delta",
};
const messageDone: Event = {
  item: {
    content: [{ annotations: [], text: "Hello", type: "output_text" }],
    id: "msg_1",
    role: "assistant",
    status: "completed",
    type: "message",
  },
  output_index: 0,
  sequence_number: 4,
  type: "response.output_item.done",
};
const completed: Event = {
  response: {
    ...(created.response as object),
    status: "completed",
    usage: { input_tokens: 10, output_tokens: 2 },
  },
  sequence_number: 5,
  type: "response.completed",
};
const whole = [
  created,
  inProgress,
  messageAdded,
  textDelta,
  messageDone,
  completed,
];

/** Whole events, then `tail` as the body's last bytes, unterminated. */
function sse(events: Event[], tail = ""): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + tail,
    { headers: { "content-type": "text/event-stream" } },
  );
}

/** A body cut off partway through a text delta. */
const halfDelta =
  'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"del';
/** `response.completed` with no blank line after it. */
const unterminatedCompleted = `data: ${JSON.stringify(completed)}\n`;

/** A guard over upstream answers handed out in turn, with what it reported. */
async function guarded(...answers: (() => Response)[]) {
  const reports: StreamEndedEarly[] = [];
  const send = vi.fn(() => {
    const next = answers.shift();
    if (!next) {
      throw new Error("asked for more answers than the test gave");
    }
    return Promise.resolve(next());
  });
  const response = await guardResponsesStream({
    onEndedEarly: (report) => reports.push(report),
    send,
  });
  return { reports, response, send };
}

function eventTypes(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => (JSON.parse(block.slice(6)) as Event).type);
}

describe("guardResponsesStream", () => {
  it("passes a stream that completes through byte for byte", async () => {
    const original = await sse(whole).text();
    const { reports, response, send } = await guarded(() => sse(whole));
    expect(await response.text()).toBe(original);
    expect(send).toHaveBeenCalledTimes(1);
    expect(reports).toEqual([]);
  });

  it("asks again when the stream closes after only its lifecycle events", async () => {
    const { reports, response, send } = await guarded(
      () => sse([created]),
      () => sse(whole),
    );
    expect(eventTypes(await response.text())).toEqual(whole.map((e) => e.type));
    expect(send).toHaveBeenCalledTimes(2);
    expect(reports).toMatchInlineSnapshot(`
      [
        {
          "first": {
            "endedMidEvent": false,
            "eventTypes": [
              "response.created",
            ],
            "lastEventTypes": [
              "response.created",
            ],
            "outputBegan": false,
            "unreadByClient": [],
          },
          "retry": "completed",
        },
      ]
    `);
  });

  it("ends with an error event when the retry closes early too", async () => {
    const { reports, response, send } = await guarded(
      () => sse([created, inProgress]),
      () => sse([created]),
    );
    const text = await response.text();
    expect(eventTypes(text)).toEqual(["response.created", "error"]);
    expect(text).toContain('"code":"stream_ended_early"');
    expect(send).toHaveBeenCalledTimes(2);
    expect(reports[0]?.retry).toBe("ended-early");
    expect(reports[0]?.second?.eventTypes).toEqual(["response.created"]);
  });

  it("does not ask again once output has reached the client", async () => {
    const { reports, response, send } = await guarded(() =>
      sse([created, messageAdded, textDelta]),
    );
    expect(eventTypes(await response.text())).toEqual([
      "response.created",
      "response.output_item.added",
      "response.output_text.delta",
      "error",
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(reports).toMatchInlineSnapshot(`
      [
        {
          "first": {
            "endedMidEvent": false,
            "eventTypes": [
              "response.created",
              "response.output_item.added",
              "response.output_text.delta",
            ],
            "lastEventTypes": [
              "response.created",
              "response.output_item.added",
              "response.output_text.delta",
            ],
            "outputBegan": true,
            "unreadByClient": [],
          },
        },
      ]
    `);
  });

  it("names an event type the client would ignore", async () => {
    const { reports } = await guarded(() =>
      sse([
        created,
        messageAdded,
        textDelta,
        { sequence_number: 4, type: "response.done" },
      ]),
    ).then(async (result) => {
      await result.response.text();
      return result;
    });
    expect(reports[0]?.first.unreadByClient).toEqual(["response.done"]);
    expect(reports[0]?.first.lastEventTypes.at(-1)).toBe("response.done");
  });

  it("passes a refused retry on as it was answered", async () => {
    const { reports, response } = await guarded(
      () => sse([created]),
      () => new Response("{}", { status: 429 }),
    );
    expect(response.status).toBe(429);
    expect(reports[0]).toMatchObject({ retry: "refused", retryStatus: 429 });
  });

  it("leaves a response that is not an event stream alone", async () => {
    const { response, send } = await guarded(() =>
      Response.json({ id: "resp_1" }),
    );
    expect(await response.json()).toEqual({ id: "resp_1" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("what the SDK makes of a guarded stream", () => {
  async function run(...answers: (() => Response)[]) {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const guardedFetch: typeof globalThis.fetch = () =>
      guardResponsesStream({
        onEndedEarly: () => {},
        send: () => Promise.resolve(answers.shift()?.() ?? sse([])),
      });
    fetch.mockImplementation(guardedFetch);
    const model = createOpenAI({ apiKey: "key", fetch }).responses(
      "gpt-5.6-sol",
    );
    const parts: unknown[] = [];
    const result = streamText({
      maxRetries: 0,
      model,
      onError: () => {},
      prompt: "Hi",
    });
    try {
      for await (const part of result.stream) {
        parts.push(part);
      }
    } catch (error) {
      parts.push({ thrown: error });
    }
    return parts.filter(
      (part): part is { error: unknown; type: "error" } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "error",
    );
  }

  it("reads an unguarded early close as a finish with no reason", async () => {
    const model = createOpenAI({
      apiKey: "key",
      fetch: () => Promise.resolve(sse([created])),
    }).responses("gpt-5.6-sol");
    const result = streamText({ maxRetries: 0, model, prompt: "Hi" });
    const types: string[] = [];
    for await (const part of result.stream) {
      types.push(part.type);
    }
    expect(types).not.toContain("error");
    expect(await result.finishReason).toBe("other");
  });

  it("reports a failure the workspace can read before any output", async () => {
    const [error] = await run(
      () => sse([created]),
      () => sse([created]),
    );
    expect(error?.error).toMatchObject({
      message: "The model's reply stopped before it finished.",
      responseBody: expect.stringContaining("stream_ended_early"),
    });
  });

  it.each([
    { name: "after output began", tail: "" },
    { name: "cut off partway through an event", tail: halfDelta },
    {
      name: "ending on a response.completed it never finished",
      tail: unterminatedCompleted,
    },
  ])(
    "reports a failure the workspace can read $name, ahead of any other",
    async ({ tail }) => {
      const errors = await run(() =>
        sse([created, messageAdded, textDelta], tail),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]?.error).toMatchObject({
        code: "stream_ended_early",
        message: "The model's reply stopped before it finished.",
      });
    },
  );
});

describe("guardResponsesStream, framing", () => {
  it("passes on no part of an event the body ended inside", async () => {
    const { reports, response } = await guarded(() =>
      sse([created, messageAdded, textDelta], halfDelta),
    );
    const text = await response.text();
    expect(text).not.toContain('"del\n');
    expect(eventTypes(text)).toEqual([
      "response.created",
      "response.output_item.added",
      "response.output_text.delta",
      "error",
    ]);
    expect(reports[0]?.first.endedMidEvent).toBe(true);
  });

  it("does not count a terminal event the client would never dispatch", async () => {
    const { reports, response } = await guarded(() =>
      sse([created, messageAdded, textDelta], unterminatedCompleted),
    );
    expect(eventTypes(await response.text()).at(-1)).toBe("error");
    expect(reports[0]?.first).toMatchObject({
      endedMidEvent: true,
      lastEventTypes: [
        "response.created",
        "response.output_item.added",
        "response.output_text.delta",
      ],
    });
  });

  it("frames events split across chunks and ended by \\r\\n", async () => {
    const text = [created, completed]
      .map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`)
      .join("");
    const bytes = new TextEncoder().encode(text);
    const { reports, response } = await guarded(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              // Split inside the first event's blank line.
              const cut = text.indexOf("\r\n\r\n") + 3;
              controller.enqueue(bytes.slice(0, cut));
              controller.enqueue(bytes.slice(cut));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    expect(await response.text()).toBe(text);
    expect(reports).toEqual([]);
  });
});

describe("guardResponsesStream, when the client goes away", () => {
  it("lets go of the held body and does not ask again", async () => {
    const client = new AbortController();
    let upstreamCanceled = false;
    const send = vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              upstreamCanceled = true;
            },
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify(created)}\n\n`,
                ),
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    const reports: StreamEndedEarly[] = [];
    const guarding = guardResponsesStream({
      onEndedEarly: (report) => reports.push(report),
      send,
      signal: client.signal,
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    client.abort();
    await (await guarding).text();
    expect(send).toHaveBeenCalledTimes(1);
    expect(upstreamCanceled).toBe(true);
    expect(reports).toEqual([]);
  });
});
