import { describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { Store } from "../store";
import { renderSteps, sessionSteps, trajectorySince } from "./steps";

vi.mock(import("../session-store-storage"));

const taskId = createMockTaskConfig(TaskIdSchema.parse("steps-outline"));

const at = (seconds: number) =>
  new Date(Date.UTC(2026, 8, 11, 18, 30, seconds));

type Part = SessionMessage.WithParts["parts"][number];

interface PartIds {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}

const partMetadata = (ids: PartIds, createdAt: Date) => ({
  createdAt,
  id: StoreId.newPartId(),
  ...ids,
});

const activity =
  (title: string, createdAt: Date) =>
  (ids: PartIds): Part => ({
    input: { title },
    metadata: { ...partMetadata(ids, createdAt), endedAt: createdAt },
    output: {},
    state: "output-available",
    toolCallId: `call_${title}`,
    type: "tool-start_activity",
  });

const call =
  (
    input: { command: string; explanation?: string },
    createdAt: Date,
    result:
      | { exitCode: number; processId?: string; state: "output-available" }
      | { state: "input-available" }
      | { state: "output-error" },
  ) =>
  (ids: PartIds): Part => {
    const base = {
      input: { ...input, yieldMs: 30_000 },
      metadata: { ...partMetadata(ids, createdAt), endedAt: createdAt },
      toolCallId: `call_${createdAt.getTime()}`,
      type: "tool-bash" as const,
    };
    switch (result.state) {
      case "input-available": {
        return { ...base, state: "input-available" };
      }
      case "output-available": {
        return {
          ...base,
          output: {
            command: input.command,
            commands: [],
            durationMs: 1,
            exitCode: result.exitCode,
            omittedBytes: 0,
            output: "",
            ...(result.processId === undefined
              ? {}
              : { processId: result.processId }),
          },
          state: "output-available",
        };
      }
      case "output-error": {
        return { ...base, errorText: "boom", state: "output-error" };
      }
    }
  };

const said =
  (text: string, createdAt: Date) =>
  (ids: PartIds): Part => ({
    metadata: partMetadata(ids, createdAt),
    text,
    type: "text",
  });

function assistant(
  sessionId: StoreId.Session,
  createdAt: Date,
  parts: ((ids: PartIds) => Part)[],
): SessionMessage.AssistantWithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: {
      createdAt,
      finishReason: "stop",
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: parts.map((part) => part({ messageId, sessionId })),
    role: "assistant",
  };
}

async function seed() {
  const sessionId = StoreId.newSessionId();
  await Store.saveSession(
    { createdAt: at(0), id: sessionId, title: "task" },
    taskId,
  );
  for (const message of [
    user(sessionId, at(0), "Inspect the repository and write\nan audit."),
    assistant(sessionId, at(3), [
      activity("Inspecting runtime changes and history", at(3)),
      call(
        { command: "git -C /mnt/repo log", explanation: "Reading history" },
        at(4),
        { exitCode: 1, state: "output-available" },
      ),
      call({ command: "rg --files /mnt/repo | head" }, at(5), {
        exitCode: 0,
        state: "output-available",
      }),
    ]),
    user(sessionId, at(40), "Change of plan: phase one only."),
    assistant(sessionId, at(44), [
      activity("Pinning the review range", at(44)),
      call(
        { command: "cp -R /mnt/repo work/", explanation: "Copying" },
        at(45),
        { exitCode: 0, processId: "bg_1", state: "output-available" },
      ),
      call({ command: "fg bg_1", explanation: "Waiting" }, at(50), {
        state: "input-available",
      }),
      call({ command: "false", explanation: "Failing" }, at(51), {
        state: "output-error",
      }),
      said("Copying the repository first, then reading the range.", at(52)),
    ]),
  ]) {
    await Store.saveMessageWithParts(message, taskId);
  }
  return sessionId;
}

function user(
  sessionId: StoreId.Session,
  createdAt: Date,
  text: string,
): SessionMessage.UserWithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: { createdAt, sessionId },
    parts: [
      {
        metadata: partMetadata({ messageId, sessionId }, createdAt),
        text,
        type: "text",
      },
    ],
    role: "user",
  };
}

describe("sessionSteps", () => {
  it("outlines a session as what the agent set out to do and each call's end", async () => {
    const sessionId = await seed();
    const steps = await sessionSteps({ sessionId, taskId });

    expect(steps.map((step) => `${step.kind}: ${step.text}`)).toEqual([
      "user: Inspect the repository and write an audit.",
      "activity: Inspecting runtime changes and history",
      "call: bash: Reading history (exit 1)",
      "call: bash: rg --files /mnt/repo | head",
      "user: Change of plan: phase one only.",
      "activity: Pinning the review range",
      "call: bash: Copying (still running as bg_1)",
      "call: bash: Waiting (running)",
      "call: bash: Failing (failed)",
      "said: Copying the repository first, then reading the range.",
    ]);
  });

  it("renders one line per step with the activity as the heading", async () => {
    const sessionId = await seed();
    const rendered = renderSteps(await sessionSteps({ sessionId, taskId }));

    // Local time, so only the shape is pinned.
    expect(rendered.split("\n")).toHaveLength(10);
    expect(rendered).toMatch(/^\d\d:\d\d:\d\d {2}user: Inspect/);
    expect(rendered).toContain("  Pinning the review range\n");
    expect(rendered).toContain("    bash: Copying (still running as bg_1)");
  });

  it("lists the activities set since a moment, for the overdue note", async () => {
    await seed();

    expect(await trajectorySince(taskId, at(40))).toEqual([
      "Pinning the review range",
    ]);
    expect(await trajectorySince(taskId, at(0))).toEqual([
      "Inspecting runtime changes and history",
      "Pinning the review range",
    ]);
  });

  it("lists the calls instead when no activity was set since the moment", async () => {
    await seed();

    expect(await trajectorySince(taskId, at(46))).toEqual([
      "bash: Waiting (running)",
      "bash: Failing (failed)",
    ]);
  });
});
