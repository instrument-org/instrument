import { describe, expect, it } from "vitest";

import { repairLine, repairWorkersAiStream } from "./workers-ai-stream-repair";

const state = () => ({ ids: new Map<number, string>(), made: 0 });

describe("repairLine", () => {
  it("gives a tool call's first chunk an id when none came, and leaves the rest alone", () => {
    const s = state();
    const first = repairLine(
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"bash","arguments":""}}]}}]}',
      s,
    );
    const later =
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"script"}}]}}]}';
    expect(first).toMatchInlineSnapshot(
      `"data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"bash","arguments":""},"id":"call_0_0"}]}}]}"`,
    );
    expect(repairLine(later, s)).toBe(later);
  });

  it("turns a numeric content or id into its digits", () => {
    expect(
      repairLine(
        'data: {"choices":[{"index":0,"delta":{"content":4}}]}',
        state(),
      ),
    ).toMatchInlineSnapshot(
      `"data: {"choices":[{"index":0,"delta":{"content":"4"}}]}"`,
    );
    expect(
      repairLine(
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":7,"function":{"name":"bash","arguments":""}}]}}]}',
        state(),
      ),
    ).toMatchInlineSnapshot(
      `"data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"7","function":{"name":"bash","arguments":""}}]}}]}"`,
    );
  });

  it("passes well-formed events, comments, and the end marker through untouched", () => {
    const s = state();
    for (const line of [
      'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}',
      ": keep-alive",
      "data: [DONE]",
      "",
    ]) {
      expect(repairLine(line, s)).toBe(line);
    }
  });
});

describe("repairWorkersAiStream", () => {
  it("mends an event stream split across chunks, and leaves other responses alone", async () => {
    const lines = [
      'data: {"choices":[{"index":0,"delta":{"content":4}}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"bash","arguments":""}}]}}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Cut inside an event, so a chunk boundary is not a line boundary.
        controller.enqueue(encoder.encode(lines.slice(0, 30)));
        controller.enqueue(encoder.encode(lines.slice(30)));
        controller.close();
      },
    });
    const fetchImpl = repairWorkersAiStream(() =>
      Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    const response = await fetchImpl("https://example.test");
    const text = await response.text();
    expect(text).toMatchInlineSnapshot(`
      "data: {"choices":[{"index":0,"delta":{"content":"4"}}]}
      data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"bash","arguments":""},"id":"call_0_0"}]}}]}
      data: [DONE]
      "
    `);

    const plain = repairWorkersAiStream(() =>
      Promise.resolve(
        new Response('{"ok":true}', {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const untouched = await plain("https://example.test");
    expect(await untouched.text()).toBe('{"ok":true}');
  });
});
