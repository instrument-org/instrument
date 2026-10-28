import { type ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import {
  nextToolResultClearing,
  projectedPromptTokens,
  toolResultsClearedThrough,
  withRecordedClearing,
} from "./tool-result-clearing";

const messageId = (value: string) => value as StoreId.Message;
const partId = (value: string) => value as StoreId.Part;

/** A step that called `tool` once per result, each returning `output`. */
const step = (
  id: string,
  calls: { output?: unknown; tool?: string }[],
  metadata: Record<string, unknown> = {},
): SessionMessage.WithParts =>
  ({
    id: messageId(id),
    metadata: { modelId: "haiku", ...metadata },
    parts: calls.map(({ output = "out", tool = "bash" }, index) => ({
      input: { command: `${id}-${index}` },
      metadata: { id: partId(`prt_${id}_${index}`) },
      output,
      state: "output-available",
      toolCallId: `${id}-${index}`,
      type: `tool-${tool}`,
    })),
    role: "assistant",
  }) as unknown as SessionMessage.WithParts;

const user = (id: string, through?: string): SessionMessage.WithParts =>
  ({
    id: messageId(id),
    metadata: {},
    parts: [
      { text: "go on", type: "text" },
      ...(through === undefined
        ? []
        : [
            {
              data: { results: 1, through: messageId(through) },
              metadata: { id: partId(`prt_${id}_cleared`) },
              type: "data-toolResultsCleared",
            },
          ]),
    ],
    role: "user",
  }) as unknown as SessionMessage.WithParts;

/** The model messages `messages` are sent as: a call and its result each. */
const sent = (messages: readonly SessionMessage.WithParts[]): ModelMessage[] =>
  messages.flatMap((message): ModelMessage[] => {
    if (message.role === "user") {
      return [{ content: "go on", role: "user" }];
    }
    const calls = message.parts.flatMap((part) =>
      part.type.startsWith("tool-") && "toolCallId" in part ? [part] : [],
    );
    return [
      {
        content: calls.map((part) => ({
          input: part.input,
          toolCallId: part.toolCallId,
          toolName: part.type.slice("tool-".length),
          type: "tool-call" as const,
        })),
        role: "assistant",
      },
      {
        content: calls.map((part) => ({
          output: { type: "text" as const, value: JSON.stringify(part.output) },
          toolCallId: part.toolCallId,
          toolName: part.type.slice("tool-".length),
          type: "tool-result" as const,
        })),
        role: "tool",
      },
    ];
  });

const results = (sizes: Record<string, number[]>) =>
  Object.entries(sizes).flatMap(([id, tokens]) =>
    tokens.map((size, index) => ({
      messageId: messageId(id),
      partId: partId(`prt_${id}_${index}`),
      tokens: size,
      toolCallId: `${id}-${index}`,
      toolName: "bash",
    })),
  );

describe("nextToolResultClearing", () => {
  it("does nothing below 85% of the price step", () => {
    expect(
      nextToolResultClearing({
        priceStepTokens: 100_000,
        projectedTokens: 84_999,
        results: results({ a1: [30_000], a2: [30_000], a3: [1], a4: [1] }),
        through: undefined,
      }),
    ).toBeUndefined();
  });

  it("clears whole messages, oldest first, until the request is under 45% of the step", () => {
    expect(
      nextToolResultClearing({
        priceStepTokens: 100_000,
        projectedTokens: 90_000,
        // 45,000 has to go: a1 and a2 free 40,000, so a3 goes too, both of its results.
        results: results({
          a1: [20_000],
          a2: [20_000],
          a3: [3_000, 3_000],
          a4: [20_000],
          a5: [1],
          a6: [1],
          a7: [1],
        }),
        through: undefined,
      }),
    ).toEqual({ results: 4, through: "a3" });
  });

  it("never clears the newest three results", () => {
    expect(
      nextToolResultClearing({
        priceStepTokens: 100_000,
        projectedTokens: 95_000,
        results: results({ a1: [25_000], a2: [20_000], a3: [20_000, 20_000] }),
        through: undefined,
      }),
    ).toEqual({ results: 1, through: "a1" });
  });

  it("starts after the clearing in force", () => {
    expect(
      nextToolResultClearing({
        priceStepTokens: 100_000,
        projectedTokens: 90_000,
        results: results({
          a1: [50_000],
          a2: [25_000],
          a3: [25_000],
          a4: [1],
          a5: [1],
          a6: [1],
        }),
        through: messageId("a1"),
      }),
    ).toEqual({ results: 2, through: "a3" });
  });

  it("does nothing when clearing would free less than 20% of the step", () => {
    expect(
      nextToolResultClearing({
        priceStepTokens: 100_000,
        projectedTokens: 99_000,
        results: results({
          a1: [10_000],
          a2: [9_000],
          a3: [1],
          a4: [1],
          a5: [1],
        }),
        through: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("projectedPromptTokens", () => {
  const tokensOf = (toolCallId: string) =>
    toolCallId.startsWith("a2") ? 500 : 50;

  it("adds the newest measured request's reply and the results of its calls", () => {
    expect(
      projectedPromptTokens({
        messages: [
          step("a1", [{}], { usage: { inputTokens: 1_000, outputTokens: 10 } }),
          step("a2", [{}, {}], {
            usage: { inputTokens: 2_000, outputTokens: 20 },
          }),
          user("u3"),
        ],
        modelId: "haiku",
        tokensOf,
      }),
    ).toBe(2_000 + 20 + 500 + 500);
  });

  it("says nothing on a count another model measured", () => {
    expect(
      projectedPromptTokens({
        messages: [
          step("a1", [{}], {
            modelId: "other",
            usage: { inputTokens: 1_000, outputTokens: 10 },
          }),
        ],
        modelId: "haiku",
        tokensOf,
      }),
    ).toBeUndefined();
  });
});

describe("toolResultsClearedThrough", () => {
  it("reads the furthest clearing recorded", () => {
    expect(
      toolResultsClearedThrough([
        step("a1", [{}]),
        user("u2", "a1"),
        step("a3", [{}]),
        user("u4", "a3"),
        user("u5"),
      ]),
    ).toBe("a3");
    expect(toolResultsClearedThrough([step("a1", [{}])])).toBeUndefined();
  });
});

describe("withRecordedClearing", () => {
  const history = [
    step("a1", [{ output: "x".repeat(2_000) }, { output: "short" }]),
    step("a2", [
      { output: { state: "success" }, tool: "load_skill" },
      { output: { browserSkill: { content: "guide" } } },
    ]),
    user("u3", "a2"),
    step("a4", [{ output: "newest" }]),
  ];

  it("sends a placeholder for each long result up to the boundary and keeps every call", () => {
    const view = withRecordedClearing({
      messages: history,
      modelMessages: sent(history),
      through: messageId("a2"),
    });
    expect(view).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "input": {
                "command": "a1-0",
              },
              "toolCallId": "a1-0",
              "toolName": "bash",
              "type": "tool-call",
            },
            {
              "input": {
                "command": "a1-1",
              },
              "toolCallId": "a1-1",
              "toolName": "bash",
              "type": "tool-call",
            },
          ],
          "role": "assistant",
        },
        {
          "content": [
            {
              "output": {
                "type": "text",
                "value": "[This bash result (2002 characters) was cleared from context to save space. It was saved to $INSTRUMENT_WORK/.tool-output/prt_a1_0.txt: read that file if you need it again, or repeat the call if the file is missing and the call is safe to repeat.]",
              },
              "toolCallId": "a1-0",
              "toolName": "bash",
              "type": "tool-result",
            },
            {
              "output": {
                "type": "text",
                "value": ""short"",
              },
              "toolCallId": "a1-1",
              "toolName": "bash",
              "type": "tool-result",
            },
          ],
          "role": "tool",
        },
        {
          "content": [
            {
              "input": {
                "command": "a2-0",
              },
              "toolCallId": "a2-0",
              "toolName": "load_skill",
              "type": "tool-call",
            },
            {
              "input": {
                "command": "a2-1",
              },
              "toolCallId": "a2-1",
              "toolName": "bash",
              "type": "tool-call",
            },
          ],
          "role": "assistant",
        },
        {
          "content": [
            {
              "output": {
                "type": "text",
                "value": "{"state":"success"}",
              },
              "toolCallId": "a2-0",
              "toolName": "load_skill",
              "type": "tool-result",
            },
            {
              "output": {
                "type": "text",
                "value": "{"browserSkill":{"content":"guide"}}",
              },
              "toolCallId": "a2-1",
              "toolName": "bash",
              "type": "tool-result",
            },
          ],
          "role": "tool",
        },
        {
          "content": "go on",
          "role": "user",
        },
        {
          "content": [
            {
              "input": {
                "command": "a4-0",
              },
              "toolCallId": "a4-0",
              "toolName": "bash",
              "type": "tool-call",
            },
          ],
          "role": "assistant",
        },
        {
          "content": [
            {
              "output": {
                "type": "text",
                "value": ""newest"",
              },
              "toolCallId": "a4-0",
              "toolName": "bash",
              "type": "tool-result",
            },
          ],
          "role": "tool",
        },
      ]
    `);
  });

  it("assembles the same bytes on every request until the next clearing", () => {
    const later = [...history, user("u5"), step("a6", [{ output: "more" }])];
    const first = JSON.stringify(
      withRecordedClearing({
        messages: history,
        modelMessages: sent(history),
        through: toolResultsClearedThrough(history),
      }),
    );
    const again = JSON.stringify(
      withRecordedClearing({
        messages: history,
        modelMessages: sent(history),
        through: toolResultsClearedThrough(history),
      }),
    );
    const next = JSON.stringify(
      withRecordedClearing({
        messages: later,
        modelMessages: sent(later),
        through: toolResultsClearedThrough(later),
      }),
    );
    expect(again).toBe(first);
    expect(next.startsWith(first.slice(0, -1))).toBe(true);
  });

  it("clears the long strings of each call's input up to the boundary", () => {
    const written = [
      {
        ...step("a1", []),
        parts: [
          {
            input: { content: "c".repeat(1_500), path: "page.html" },
            metadata: { id: partId("prt_a1_0") },
            output: "Wrote page.html",
            state: "output-available",
            toolCallId: "a1-0",
            type: "tool-write_file",
          },
        ],
      } as unknown as SessionMessage.WithParts,
      user("u2", "a1"),
      {
        ...step("a3", []),
        parts: [
          {
            input: { content: "d".repeat(1_500), path: "page.html" },
            metadata: { id: partId("prt_a3_0") },
            output: "Wrote page.html",
            state: "output-available",
            toolCallId: "a3-0",
            type: "tool-write_file",
          },
        ],
      } as unknown as SessionMessage.WithParts,
    ];
    const inputs = withRecordedClearing({
      messages: written,
      modelMessages: sent(written),
      through: messageId("a1"),
    }).flatMap((message) =>
      message.role === "assistant" && typeof message.content !== "string"
        ? message.content.flatMap((part) =>
            part.type === "tool-call" ? [part.input] : [],
          )
        : [],
    );
    expect(inputs).toEqual([
      { content: "[1500 characters cleared from context]", path: "page.html" },
      { content: "d".repeat(1_500), path: "page.html" },
    ]);
  });

  it("keeps the command of a call that handed over an app guide", () => {
    const command = `instrument app guide crm <<'EOF'\n${"g".repeat(1_500)}\nEOF`;
    const written = [
      {
        ...step("a1", []),
        parts: [
          {
            input: { command },
            metadata: { id: partId("prt_a1_0") },
            output: { appGuides: [{ app: "crm", hash: "h" }], output: "Wrote" },
            state: "output-available",
            toolCallId: "a1-0",
            type: "tool-bash",
          },
        ],
      } as unknown as SessionMessage.WithParts,
      user("u2", "a1"),
    ];
    const inputs = withRecordedClearing({
      messages: written,
      modelMessages: sent(written),
      through: messageId("a1"),
    }).flatMap((message) =>
      message.role === "assistant" && typeof message.content !== "string"
        ? message.content.flatMap((part) =>
            part.type === "tool-call" ? [part.input] : [],
          )
        : [],
    );
    expect(inputs).toEqual([{ command }]);
  });

  it("changes nothing where no clearing is recorded", () => {
    const modelMessages = sent(history);
    expect(
      withRecordedClearing({
        messages: history,
        modelMessages,
        through: undefined,
      }),
    ).toBe(modelMessages);
  });
});
