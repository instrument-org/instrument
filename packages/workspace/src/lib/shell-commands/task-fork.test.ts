import { encodeUtf8ToBytes } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { subcommandRunner } from "../../test/helpers/run-subcommand";
import { oneAgent } from "../../agents/one";
import { folderReach } from "../chat/folder-reach";
import { createSession } from "../create-session";
import {
  prepareModelMessages,
  SESSION_CONTEXT_VERSION,
} from "../prepare-model-messages";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { chatPathOfWorkDir, workDir } from "../work-dir";
import { effectiveFolderAccess } from "../workspace-fs-layout";
import { getTaskState, setTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type TaskCommandContext } from "./task/context";
import { forkSubcommand } from "./task/fork";
import { type HandOff, withHandOffs } from "./task-hand-off";

const runFork = subcommandRunner(forkSubcommand, "task fork");

const sent = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      send: (event: unknown) => {
        sent.events.push(event);
      },
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: () =>
    Promise.resolve({ ok: true, value: createMockAIGatewayModel() }) as never,
}));

let counter = 0;
let rootDir: string;
let context: TaskCommandContext;
let chatSessionId: StoreId.Session;
let oneAgentOn = true;

beforeEach(async () => {
  counter += 1;
  oneAgentOn = true;
  sent.events = [];
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-fork-"));
  createMockTaskConfigForDir(path.join(rootDir, "tasks", "unused"), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    oneAgentMode: () => (oneAgentOn ? "fork" : undefined),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  chatSessionId = StoreId.newSessionId();
  const chatId = chatFor(
    chatSessionId,
    ChatIdSchema.parse(`2026-10-06-files-${counter}`),
  );
  context = {
    chatId,
    remainingYieldMs: () => Number.POSITIVE_INFINITY,
    sessionId: chatSessionId,
  };
  await setTaskState(taskDir(chatId), {
    selectedModelURI:
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
  });
  const session = await createSession({
    sessionId: chatSessionId,
    taskId: chatId,
  });
  if (session.isErr()) {
    throw session.error;
  }
  await fs.mkdir(path.join(taskDir(chatId), "attachments"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(taskDir(chatId), "attachments", "list.csv"),
    "a,b\n",
  );
  for (const message of conversation(chatSessionId)) {
    const saved = await Store.saveMessageWithParts(message, chatId);
    if (saved.isErr()) {
      throw saved.error;
    }
  }
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

/**
 * A chat mid-turn: its baseline, the user's ask, a finished command, and the
 * reply in flight whose last call is the `fork` itself, still unanswered.
 */
function conversation(sessionId: StoreId.Session): SessionMessage.WithParts[] {
  const createdAt = new Date("2026-10-06T10:00:00.000Z");
  const message = <T extends SessionMessage.WithParts>(
    build: (id: StoreId.Message) => T,
  ) => build(StoreId.newMessageId());
  const meta = (messageId: StoreId.Message) => ({
    createdAt,
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  });
  const assistantMeta = {
    createdAt,
    finishReason: "tool-calls" as const,
    modelId: "mock-model",
    msToFinish: 1200,
    providerId: "instrument",
    sessionId,
    usage: {
      inputTokenDetails: {},
      inputTokens: 900,
      outputTokenDetails: {},
      outputTokens: 40,
      totalTokens: 940,
    },
  };
  return [
    message((id) => ({
      id,
      metadata: {
        agentName: "instrument-one" as const,
        contextVersion: SESSION_CONTEXT_VERSION,
        createdAt,
        realRole: "system" as const,
        sessionId,
      },
      parts: [
        { metadata: meta(id), text: oneAgent.systemPrompt(), type: "text" },
      ],
      role: "session-context" as const,
    })),
    message((id) => ({
      id,
      metadata: { createdAt, sessionId },
      parts: [
        {
          metadata: meta(id),
          text: "Rename all fifty photos by date",
          type: "text",
        },
      ],
      role: "user" as const,
    })),
    message((id) => ({
      id,
      metadata: assistantMeta,
      parts: [
        {
          input: { command: "ls", explanation: "Listing", yieldMs: 1000 },
          metadata: { ...meta(id), endedAt: createdAt },
          output: {
            command: "ls",
            commands: ["ls"],
            durationMs: 1,
            exitCode: 0,
            omittedBytes: 0,
            output: "a.jpg",
          },
          state: "output-available",
          toolCallId: "call-ls",
          type: "tool-bash",
        },
      ],
      role: "assistant" as const,
    })),
    message((id) => ({
      id,
      metadata: assistantMeta,
      parts: [
        {
          metadata: meta(id),
          state: "done",
          text: "Renaming them in the background.",
          type: "text",
        },
        {
          input: {
            command: "task fork --name 'Rename photos'",
            explanation: "Forking",
            yieldMs: 1000,
          },
          metadata: meta(id),
          state: "input-available",
          toolCallId: "call-fork",
          type: "tool-bash",
        },
      ],
      role: "assistant" as const,
    })),
  ];
}

async function fork() {
  const handOffs: HandOff[] = [];
  const result = await withHandOffs(handOffs, () =>
    runFork(
      ["--name", "Rename photos"],
      context,
      // A directive of its own per test, since the fork's id comes from it
      // and a store handle is kept per id.
      encodeUtf8ToBytes(
        `Batch ${counter}: rename every photo in Downloads by its date taken.`,
      ),
    ),
  );
  return { handOffs, result };
}

function forkId(handOffs: HandOff[]): TaskId {
  return TaskIdSchema.parse(handOffs[0]?.taskId);
}

describe("task fork", () => {
  it("starts the one agent on the chat's conversation, then the directive", async () => {
    const { handOffs, result } = await fork();
    expect(result.exitCode).toBe(0);
    expect(handOffs.map((handOff) => handOff.kind)).toEqual(["created"]);
    const id = forkId(handOffs);
    expect(await getTaskSettings(taskDir(id))).toMatchObject({
      fork: true,
      workdir: context.chatId,
    });

    const sessions = await Store.getSessions(id);
    const sessionId = sessions._unsafeUnwrap()[0]?.id;
    if (!sessionId) {
      throw new Error("the fork has no session");
    }
    const copied = (
      await Store.getMessagesWithParts({ sessionId, taskId: id })
    )._unsafeUnwrap();
    const chat = (
      await Store.getMessagesWithParts({
        sessionId: chatSessionId,
        taskId: context.chatId,
      })
    )._unsafeUnwrap();

    // Same ids in the same order, filed under the fork's session and marked
    // as inherited.
    expect(copied.map((message) => message.id)).toEqual(
      chat.map((message) => message.id),
    );
    expect(
      copied.every(
        (message) =>
          message.metadata.sessionId === sessionId &&
          message.metadata.inherited === true &&
          message.parts.every((part) => part.metadata.sessionId === sessionId),
      ),
    ).toBe(true);
    // The fork call itself, unanswered, stays behind; the line before it comes.
    expect(copied.at(-1)?.parts.map((part) => part.type)).toEqual(["text"]);
    // The chat already counted what its replies spent.
    expect(
      copied.flatMap((message) =>
        message.role === "assistant" ? [message.metadata.usage] : [],
      ),
    ).toEqual([undefined, undefined]);

    const start = sent.events.find(
      (event): event is { type: "createSession"; value: unknown } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "createSession",
    );
    expect(start?.value).toMatchObject({ agentName: "instrument-one", id });
    const directive = JSON.stringify(start?.value);
    expect(directive).toContain(
      "Everything above is background context, not your assignment",
    );
    expect(directive).toContain("Your assignment:\\nBatch");
    expect(directive).toContain(
      "rename every photo in Downloads by its date taken",
    );
  });

  it("works in the chat's own folder, keeping only its record in its own", async () => {
    const { handOffs } = await fork();
    const id = forkId(handOffs);
    expect(workDir(id)).toBe(taskDir(context.chatId));
    // What it reports in its own `/task` paths is the chat's `/task` too.
    expect(chatPathOfWorkDir(id, context.chatId)).toBe("/task");
    await expect(
      fs.readFile(path.join(workDir(id), "attachments", "list.csv"), "utf8"),
    ).resolves.toBe("a,b\n");
    expect(await fs.readdir(taskDir(id))).toEqual([".instrument"]);
  });

  it("is what `task new` runs, and --fresh is not", async () => {
    const asNew = subcommandRunner(forkSubcommand, "task new");
    const handOffs: HandOff[] = [];
    await withHandOffs(handOffs, () =>
      asNew(
        ["--name", "Rename photos"],
        context,
        encodeUtf8ToBytes(`Batch ${counter}: rename them.`),
      ),
    );
    expect((await getTaskSettings(taskDir(forkId(handOffs))))?.fork).toBe(true);
  });

  it("sends the chat's request as the prefix of its first one", async () => {
    const { handOffs } = await fork();
    const id = forkId(handOffs);
    const start = sent.events.find(
      (event): event is { type: "createSession"; value: { message: never } } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "createSession",
    );
    const sessionId = (await Store.getSessions(id))._unsafeUnwrap()[0]?.id;
    if (!start || !sessionId) {
      throw new Error("the fork did not start");
    }
    // The session machine saves the directive before the first request.
    (await Store.saveMessageWithParts(start.value.message, id))._unsafeUnwrap();

    const model = createMockAIGatewayModel();
    const request = async (taskId: TaskId, session: StoreId.Session) =>
      (
        await prepareModelMessages({
          agent: oneAgent,
          model,
          sessionId: session,
          signal: new AbortController().signal,
          taskId,
        })
      )
        ._unsafeUnwrap()
        // Where the cache breakpoints sit moves with the newest message, and
        // is a request option rather than bytes of the prefix.
        .map(({ providerOptions: _options, ...message }) => message);
    const chat = await request(context.chatId, chatSessionId);
    const forked = await request(id, sessionId);

    // System prompt, the ask, the `ls` call and its result, and the line.
    expect(chat.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(forked.slice(0, chat.length)).toEqual(chat);
    expect(forked).toHaveLength(chat.length + 1);
    expect(JSON.stringify(forked.at(-1))).toContain(
      "Everything above is background context, not your assignment",
    );
  });

  it("grants nothing it already reaches, and leaves the chat's folders alone", async () => {
    const reach = Object.values(await folderReach(context.chatId));
    const writable = reach.find(
      (folder) => effectiveFolderAccess(folder) === "read-write",
    );
    if (!writable) {
      throw new Error("the chat reaches no writable folder");
    }
    await fs.mkdir(path.join(writable.path, "Ideas"), { recursive: true });
    const before = (await getTaskState(taskDir(context.chatId)))
      .attachedFolders;

    const handOffs: HandOff[] = [];
    await withHandOffs(handOffs, () =>
      runFork(
        ["--name", "Ideas", "--folder", `/mnt/${writable.mountName}/Ideas:rw`],
        context,
        encodeUtf8ToBytes(`Batch ${counter}: write the ideas.`),
      ),
    );

    expect(
      (await getTaskState(taskDir(context.chatId))).attachedFolders,
    ).toEqual(before);
    const forkFolders = Object.values(
      (await getTaskState(taskDir(forkId(handOffs)))).attachedFolders ?? {},
    );
    expect(forkFolders.map((folder) => folder.path).toSorted()).toEqual(
      reach.map((folder) => folder.path).toSorted(),
    );
  });

  it("refuses without the one agent", async () => {
    oneAgentOn = false;
    await expect(fork()).rejects.toThrow(/not available/);
  });
});
