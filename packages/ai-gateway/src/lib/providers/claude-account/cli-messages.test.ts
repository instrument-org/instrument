import {
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import {
  endTurnOnResults,
  historyFrameTaken,
  nextMessage,
} from "./cli-messages";

/** A process whose CLI reports `messages`, then exits. */
function source(messages: Partial<SDKMessage>[]) {
  const queue = [...messages];
  return {
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
    stderr: "the CLI's last words",
  };
}

describe("nextMessage", () => {
  it("keeps a usage report on the source and reads on past it", async () => {
    const reading = source([
      { rate_limit_info: { status: "allowed" }, type: "rate_limit_event" },
      { type: "user" },
    ]);
    await expect(nextMessage(reading)).resolves.toEqual({ type: "user" });
    expect(reading.rateLimit).toEqual({ status: "allowed" });
  });

  it("fails on a turn that ended in failure", async () => {
    await expect(
      nextMessage(
        source([
          {
            errors: ["out of turns"],
            is_error: true,
            subtype: "error_max_turns",
            type: "result",
          },
        ]),
      ),
    ).rejects.toThrow("out of turns");
  });

  it.each<{
    expected: { statusCode: number; type: string };
    name: string;
    result: Partial<Extract<SDKResultMessage, { subtype: "success" }>>;
  }>([
    {
      expected: { statusCode: 400, type: "claude_account_prompt_too_long" },
      name: "a prompt too long",
      result: {
        result: "Prompt is too long",
        terminal_reason: "prompt_too_long",
      },
    },
    {
      expected: { statusCode: 400, type: "claude_account_prompt_too_long" },
      name: "the window's blocking limit",
      result: {
        result: "Context limit reached",
        terminal_reason: "blocking_limit",
      },
    },
    {
      expected: { statusCode: 429, type: "rate_limit_error" },
      name: "the blocking limit while throttled",
      result: {
        api_error_status: 429,
        result: "API Error: 429",
        terminal_reason: "blocking_limit",
      },
    },
    {
      expected: { statusCode: 400, type: "claude_account_image_error" },
      name: "an image the API would not take",
      result: {
        result: "Could not process image",
        terminal_reason: "image_error",
      },
    },
    {
      expected: { statusCode: 400, type: "invalid_request_error" },
      name: "repeated malformed tool calls",
      result: {
        result: "Gave up",
        terminal_reason: "malformed_tool_use_exhausted",
      },
    },
    {
      expected: { statusCode: 529, type: "overloaded_error" },
      name: "an overloaded API after Claude Code's own retries",
      result: { api_error_status: 529, result: "API Error: 529 Overloaded" },
    },
    {
      expected: { statusCode: 502, type: "api_error" },
      name: "a server error after Claude Code's own retries",
      result: { api_error_status: 500, result: "API Error: 500" },
    },
    {
      expected: { statusCode: 500, type: "api_error" },
      name: "a failure that says nothing more",
      result: { result: "Something went wrong" },
    },
  ])("names $name from the result", async ({ expected, result }) => {
    const failure = await nextMessage(
      source([
        { is_error: true, subtype: "success", type: "result", ...result },
      ]),
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      responseBody: expect.stringContaining(`"type":"${expected.type}"`),
      statusCode: expected.statusCode,
    });
  });

  it("fails with what the CLI said when it exits", async () => {
    await expect(nextMessage(source([]))).rejects.toThrow(
      /the CLI's last words/,
    );
  });
});

describe("historyFrameTaken", () => {
  it("returns on a result of no turns", async () => {
    await expect(
      historyFrameTaken(
        source([
          { is_error: false, num_turns: 0, subtype: "success", type: "result" },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it("fails when the frame ran a turn", async () => {
    await expect(
      historyFrameTaken(
        source([
          { is_error: false, num_turns: 1, subtype: "success", type: "result" },
        ]),
      ),
    ).rejects.toThrow(/ran a turn on a frame of history/);
  });
});

describe("endTurnOnResults", () => {
  it("returns once the turn ends on the results", async () => {
    await expect(
      endTurnOnResults(
        source([
          { type: "user" },
          { is_error: false, subtype: "success", type: "result" },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it("fails the step when the model is asked about the results first", async () => {
    await expect(
      endTurnOnResults(source([{ type: "user" }, { type: "stream_event" }])),
    ).rejects.toThrow(/before the message that came after them/);
  });
});
