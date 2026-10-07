import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { oneAgent } from "../agents/one";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { chatFor } from "../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createSession } from "./create-session";
import {
  forkInterruptedTurn,
  interruptedTurnPrefix,
  keepsTheWork,
  runningForks,
} from "./fork-on-interrupt";
import { SESSION_CONTEXT_VERSION } from "./prepare-model-messages";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";
import { setTaskState } from "./task-record";
import { getTaskSettings } from "./task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const sent = vi.hoisted(() => ({
  events: [] as unknown[],
  onSend: undefined as ((event: unknown) => void) | undefined,
}));
const working = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock(import("./workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      send: (event: unknown) => {
        sent.events.push(event);
        sent.onSend?.(event);
      },
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

vi.mock(import("./chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: (id: TaskId) => working.ids.has(id),
}));

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: () =>
    Promise.resolve({ ok: true, value: createMockAIGatewayModel() }) as never,
}));

const createdAt = new Date("2026-10-07T10:00:00.000Z");
const SUPERSEDED =
  "This action was interrupted by a newer message from the user, and may not have finished.";

function meta(messageId: StoreId.Message, sessionId: StoreId.Session) {
  return { createdAt, id: StoreId.newPartId(), messageId, sessionId };
}

function user(
  sessionId: StoreId.Session,
  text: string,
): SessionMessage.UserWithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: { createdAt, sessionId },
    parts: [{ metadata: meta(id, sessionId), text, type: "text" }],
    role: "user",
  };
}

/** A step of the reply: a `bash` call, finished, cut short, or still running. */
function step(
  sessionId: StoreId.Session,
  call: "cut short" | "done" | "running" | "text only",
  {
    finishReason = "tool-calls",
  }: { finishReason?: "aborted" | "stop" | "tool-calls" } = {},
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const input = { command: "node reply.mjs", explanation: "Replying" };
  const bash: Record<typeof call, SessionMessagePart.Type | undefined> = {
    "cut short": {
      errorText: SUPERSEDED,
      input,
      metadata: { ...meta(id, sessionId), endedAt: createdAt },
      state: "output-error",
      toolCallId: `call-${id}`,
      type: "tool-bash",
    } as SessionMessagePart.Type,
    done: {
      input,
      metadata: { ...meta(id, sessionId), endedAt: createdAt },
      output: {
        command: input.command,
        commands: [input.command],
        durationMs: 1,
        exitCode: 0,
        omittedBytes: 0,
        output: "wrote reply-001.txt",
      },
      state: "output-available",
      toolCallId: `call-${id}`,
      type: "tool-bash",
    } as SessionMessagePart.Type,
    running: {
      input,
      metadata: meta(id, sessionId),
      state: "input-available",
      toolCallId: `call-${id}`,
      type: "tool-bash",
    } as SessionMessagePart.Type,
    "text only": undefined,
  };
  const part = bash[call];
  return {
    id,
    metadata: {
      createdAt,
      finishedAt: createdAt,
      finishReason,
      modelId: "mock-model",
      providerId: "instrument",
      sessionId,
    },
    parts: [
      {
        metadata: meta(id, sessionId),
        state: "done",
        text: "On it.",
        type: "text",
      },
      ...(part ? [part] : []),
    ],
    role: "assistant",
  };
}

describe("interruptedTurnPrefix", () => {
  const sessionId = StoreId.newSessionId();
  const earlier = user(sessionId, "Hi, I'm Sam.");
  const earlierReply = step(sessionId, "text only", { finishReason: "stop" });
  const ask = user(sessionId, "Reply to each of the 200 feedback notes.");
  const interruption = user(sessionId, "unrelated, quick: what's 18% of 240?");

  it("keeps the conversation through the turn's last finished step", () => {
    const first = step(sessionId, "done");
    const second = step(sessionId, "done");
    const cut = step(sessionId, "cut short");
    const prefix = interruptedTurnPrefix(
      [earlier, earlierReply, ask, first, second, cut, interruption],
      { exclude: [interruption.id], turnMessageId: ask.id },
    );
    expect(prefix?.map((message) => message.id)).toEqual(
      [earlier, earlierReply, ask, first, second].map((message) => message.id),
    );
  });

  it("cuts at a step still running, or one whose request was aborted", () => {
    const first = step(sessionId, "done");
    for (const unfinished of [
      step(sessionId, "running"),
      step(sessionId, "text only", { finishReason: "aborted" }),
    ]) {
      expect(
        interruptedTurnPrefix(
          [ask, first, unfinished, step(sessionId, "done")],
          {
            exclude: [],
            turnMessageId: ask.id,
          },
        )?.map((message) => message.id),
      ).toEqual([ask.id, first.id]);
    }
  });

  it("cuts at the message that interrupted, even saved before the step", () => {
    const first = step(sessionId, "done");
    expect(
      interruptedTurnPrefix(
        [ask, first, interruption, step(sessionId, "done")],
        { exclude: [interruption.id], turnMessageId: ask.id },
      )?.map((message) => message.id),
    ).toEqual([ask.id, first.id]);
  });

  it("forks nothing from a turn that finished no tool work", () => {
    expect(
      interruptedTurnPrefix([ask, step(sessionId, "cut short")], {
        exclude: [],
        turnMessageId: ask.id,
      }),
    ).toBeUndefined();
    expect(
      interruptedTurnPrefix([ask, step(sessionId, "text only")], {
        exclude: [],
        turnMessageId: ask.id,
      }),
    ).toBeUndefined();
  });

  it("forks nothing from a turn that had already given its answer", () => {
    expect(
      interruptedTurnPrefix(
        [
          ask,
          step(sessionId, "done"),
          step(sessionId, "text only", { finishReason: "stop" }),
        ],
        { exclude: [], turnMessageId: ask.id },
      ),
    ).toBeUndefined();
  });

  it("forks nothing from a turn a task's note started", () => {
    const note: SessionMessage.UserWithParts = {
      ...ask,
      parts: [
        {
          data: { events: [] },
          metadata: meta(ask.id, sessionId),
          type: "data-taskEvent",
        } as SessionMessagePart.Type,
      ],
    };
    expect(
      interruptedTurnPrefix([note, step(sessionId, "done")], {
        exclude: [],
        turnMessageId: ask.id,
      }),
    ).toBeUndefined();
  });
});

describe("keepsTheWork", () => {
  it.each([
    ["unrelated, quick: what's 18% of 240?", true],
    ["Also make them shorter.", true],
    ["Don't stop, but use first names.", true],
    ["stop", false],
    ["Stop!", false],
    ["cancel that", false],
    ["never mind", false],
    ["forget it, I'll do it myself", false],
  ])("%s: %s", (text, keeps) => {
    expect(keepsTheWork(user(StoreId.newSessionId(), text))).toBe(keeps);
  });
});

describe("forkInterruptedTurn", () => {
  let counter = 0;
  let rootDir: string;
  let chatId: ChatId;
  let chatSessionId: StoreId.Session;
  let ask: SessionMessage.UserWithParts;
  let finished: SessionMessage.WithParts;
  let interruption: SessionMessage.UserWithParts;

  beforeEach(async () => {
    counter += 1;
    sent.events = [];
    sent.onSend = undefined;
    working.ids.clear();
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "fork-on-interrupt-"));
    // The chat reaches the home folder read and write, so a test that writes
    // into what it reaches would otherwise write into the real one.
    const home = path.join(rootDir, "home");
    await fs.mkdir(path.join(home, "Documents", "Instrument"), {
      recursive: true,
    });
    vi.spyOn(os, "homedir").mockReturnValue(home);
    createMockTaskConfigForDir(path.join(rootDir, "tasks", "unused"), {
      unplaced: true,
    });
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      defaultTaskTemplateDir: AbsolutePathSchema.parse(
        path.resolve(import.meta.dirname, "../../templates/default"),
      ),
      isForkOnInterruptEnabled: () => true,
      oneAgentMode: () => "fork",
      rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
    });
    chatSessionId = StoreId.newSessionId();
    chatId = chatFor(
      chatSessionId,
      ChatIdSchema.parse(`2026-10-07-replies-${counter}`),
    );
    await setTaskState(taskDir(chatId), {
      selectedModelURI:
        "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    });
    (
      await createSession({ sessionId: chatSessionId, taskId: chatId })
    )._unsafeUnwrap();
    const baseline: SessionMessage.WithParts = {
      id: StoreId.newMessageId(),
      metadata: {
        agentName: "instrument-one",
        contextVersion: SESSION_CONTEXT_VERSION,
        createdAt,
        realRole: "system",
        sessionId: chatSessionId,
      },
      parts: [],
      role: "session-context",
    };
    baseline.parts.push({
      metadata: meta(baseline.id, chatSessionId),
      text: oneAgent.systemPrompt(),
      type: "text",
    });
    ask = user(
      chatSessionId,
      `Batch ${counter}: reply to each of the 200 feedback notes.`,
    );
    finished = step(chatSessionId, "done");
    interruption = user(chatSessionId, "unrelated, quick: what's 18% of 240?");
    for (const message of [
      baseline,
      ask,
      finished,
      step(chatSessionId, "cut short"),
      interruption,
    ]) {
      (await Store.saveMessageWithParts(message, chatId))._unsafeUnwrap();
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(rootDir, { force: true, recursive: true });
  });

  const fork = (signal?: AbortSignal) =>
    forkInterruptedTurn({
      chatId,
      chatSessionId,
      exclude: [interruption.id],
      signal,
      turnMessageId: ask.id,
    });

  function started() {
    return sent.events.filter(
      (event): event is { type: "createSession"; value: { id: TaskId } } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "createSession",
    );
  }

  it("starts a fork of the chat that inherits the turn up to its last finished step", async () => {
    const forked = await fork();
    if (!forked) {
      throw new Error("nothing was forked");
    }
    expect(await getTaskSettings(taskDir(forked.taskId))).toMatchObject({
      fork: true,
      forkedOnInterrupt: true,
      workdir: chatId,
    });
    const sessionId = (
      await Store.getSessions(forked.taskId)
    )._unsafeUnwrap()[0]?.id;
    if (!sessionId) {
      throw new Error("the fork has no session");
    }
    const copied = (
      await Store.getMessagesWithParts({ sessionId, taskId: forked.taskId })
    )._unsafeUnwrap();
    expect(copied.slice(1).map((message) => message.id)).toEqual([
      ask.id,
      finished.id,
    ]);
    expect(copied.every((message) => message.metadata.inherited)).toBe(true);

    const [start] = started();
    expect(start?.value).toMatchObject({
      agentName: "instrument-one",
      id: forked.taskId,
    });
    const directive = JSON.stringify(start?.value);
    expect(directive).toContain(
      "Everything above is background context, not your assignment",
    );
    expect(directive).toContain(
      "Carry on with the work this conversation was in the middle of",
    );
    expect(forked.name).toMatch(/feedback notes/);
  });

  it("forks nothing while the chat's last auto-fork still runs", async () => {
    const first = await fork();
    if (!first) {
      throw new Error("nothing was forked");
    }
    working.ids.add(first.taskId);
    await expect(fork()).resolves.toBeUndefined();
    working.ids.clear();
    await expect(fork()).resolves.toMatchObject({ taskId: expect.any(String) });
    expect(started()).toHaveLength(2);
  });

  it("makes no fork once the chat has been stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fork(controller.signal)).resolves.toBeUndefined();
    expect(sent.events).toEqual([]);
  });

  it("stops a fork that started as the chat was stopped", async () => {
    const controller = new AbortController();
    sent.onSend = (event) => {
      if ((event as { type: string }).type === "createSession") {
        controller.abort();
      }
    };
    await expect(fork(controller.signal)).resolves.toBeUndefined();
    const [start] = started();
    expect(sent.events.at(-1)).toEqual({
      type: "stopSessions",
      value: { id: start?.value.id },
    });
  });

  it("lists the chat's running forks for a stop of the chat", async () => {
    const forked = await fork();
    if (!forked) {
      throw new Error("nothing was forked");
    }
    expect(await runningForks(chatId)).toEqual([]);
    working.ids.add(forked.taskId);
    expect(await runningForks(chatId)).toEqual([forked.taskId]);
  });
});
