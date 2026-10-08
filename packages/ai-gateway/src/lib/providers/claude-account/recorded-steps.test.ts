import { type LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { type RecordedStep, replayStep } from "./step-fixtures";

// Steps real Claude Code sent, recorded by record-fixtures.live.test.ts, run
// through the stream mapping offline.

function fixture(name: string): RecordedStep[] {
  return JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, "fixtures", `${name}.json`),
      "utf8",
    ),
  ) as RecordedStep[];
}

/** What a step amounts to for our loop, leaving out ids and exact wording. */
function summarize(
  parts: LanguageModelV4StreamPart[],
  awaitingToolCallIds: string[],
) {
  const finish = parts.find((part) => part.type === "finish");
  const types = new Set(parts.map((part) => part.type));
  return {
    awaitingToolCalls: awaitingToolCallIds.length,
    finishReason:
      finish?.type === "finish" ? finish.finishReason.unified : undefined,
    hasInputTokens:
      finish?.type === "finish" && (finish.usage.inputTokens.total ?? 0) > 0,
    hasOutputTokens:
      finish?.type === "finish" && (finish.usage.outputTokens.total ?? 0) > 0,
    hasReasoning: types.has("reasoning-delta"),
    hasText: types.has("text-delta"),
    sources: parts.filter((part) => part.type === "source").length,
    toolCalls: parts.flatMap((part) =>
      part.type === "tool-call"
        ? [
            {
              input: JSON.parse(part.input) as unknown,
              toolName: part.toolName,
            },
          ]
        : [],
    ),
  };
}

/** Every part a block opens is closed, in order, as the AI SDK expects. */
function unbalancedBlocks(parts: LanguageModelV4StreamPart[]) {
  const open = new Set<string>();
  const problems: string[] = [];
  for (const part of parts) {
    const id = "id" in part ? part.id : undefined;
    if (id === undefined) {
      continue;
    }
    if (part.type.endsWith("-start")) {
      open.add(id);
    } else if (part.type.endsWith("-end")) {
      if (!open.delete(id)) {
        problems.push(`${part.type} without a start`);
      }
    } else if (part.type.endsWith("-delta") && !open.has(id)) {
      problems.push(`${part.type} outside its block`);
    }
  }
  return [...problems, ...[...open].map(() => "a block never closed")];
}

/** Every recorded step of a fixture, replayed in order and summarized. */
async function replayFixture(name: string) {
  const summaries = [];
  const parts: LanguageModelV4StreamPart[] = [];
  for (const step of fixture(name)) {
    const replayed = await replayStep(step);
    parts.push(...replayed.parts);
    summaries.push(summarize(replayed.parts, replayed.awaitingToolCallIds));
  }
  return { problems: unbalancedBlocks(parts), summaries };
}

describe("recorded Claude Code steps", () => {
  it("text and thinking", async () => {
    const { problems, summaries } = await replayFixture("text-and-thinking");
    expect(problems).toEqual([]);
    expect(summaries).toMatchInlineSnapshot(`
      [
        {
          "awaitingToolCalls": 0,
          "finishReason": "stop",
          "hasInputTokens": true,
          "hasOutputTokens": true,
          "hasReasoning": true,
          "hasText": true,
          "sources": 0,
          "toolCalls": [],
        },
      ]
    `);
  });

  it("a tool call, then the step after its result", async () => {
    const { problems, summaries } = await replayFixture(
      "tool-call-and-follow-up",
    );
    expect(problems).toEqual([]);
    expect(summaries).toMatchInlineSnapshot(`
      [
        {
          "awaitingToolCalls": 1,
          "finishReason": "tool-calls",
          "hasInputTokens": true,
          "hasOutputTokens": true,
          "hasReasoning": false,
          "hasText": false,
          "sources": 0,
          "toolCalls": [
            {
              "input": {
                "a": 2,
                "b": 3,
              },
              "toolName": "add",
            },
          ],
        },
        {
          "awaitingToolCalls": 0,
          "finishReason": "stop",
          "hasInputTokens": true,
          "hasOutputTokens": true,
          "hasReasoning": false,
          "hasText": true,
          "sources": 0,
          "toolCalls": [],
        },
      ]
    `);
  });

  it("two tool calls in one step", async () => {
    const { problems, summaries } = await replayFixture("parallel-tool-calls");
    expect(problems).toEqual([]);
    expect(summaries).toMatchInlineSnapshot(`
      [
        {
          "awaitingToolCalls": 2,
          "finishReason": "tool-calls",
          "hasInputTokens": true,
          "hasOutputTokens": true,
          "hasReasoning": false,
          "hasText": false,
          "sources": 0,
          "toolCalls": [
            {
              "input": {
                "a": 1,
                "b": 2,
              },
              "toolName": "add",
            },
            {
              "input": {
                "a": 3,
                "b": 4,
              },
              "toolName": "add",
            },
          ],
        },
        {
          "awaitingToolCalls": 0,
          "finishReason": "stop",
          "hasInputTokens": true,
          "hasOutputTokens": true,
          "hasReasoning": false,
          "hasText": true,
          "sources": 0,
          "toolCalls": [],
        },
      ]
    `);
  });

  it("a search Claude Code runs itself stays inside one step", async () => {
    const { problems, summaries } = await replayFixture("native-web-search");
    expect(problems).toEqual([]);
    expect(summaries).toMatchInlineSnapshot(`
      [
        {
          "awaitingToolCalls": 0,
          "finishReason": "stop",
          "hasInputTokens": true,
          "hasOutputTokens": true,
          "hasReasoning": true,
          "hasText": true,
          "sources": 10,
          "toolCalls": [],
        },
      ]
    `);
  });
});
