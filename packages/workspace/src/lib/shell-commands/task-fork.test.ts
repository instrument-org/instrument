import { encodeUtf8ToBytes } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { subcommandRunner } from "../../test/helpers/run-subcommand";
import { instrumentAgent } from "../../agents/instrument";
import { folderReach } from "../chat/folder-reach";
import { createSession } from "../create-session";
import {
  prepareModelMessages,
  SESSION_CONTEXT_VERSION,
} from "../prepare-model-messages";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { effectiveFolderAccess } from "../workspace-fs-layout";
import { getTaskState, setTaskState } from "../task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type TaskCommandContext } from "./task/context";
import { folderSubcommand } from "./task/folder";
import { newSubcommand } from "./task/fork";
import { type HandOff, withHandOffs } from "./task-hand-off";

const runNew = subcommandRunner(newSubcommand, "task new");

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

const jobs = vi.hoisted(() => ({
  handed: [] as unknown[],
  running: [] as { id: string; status: string }[],
}));

vi.mock(import("../background-processes"), async (importOriginal) => ({
  ...(await importOriginal()),
  handOverBackgroundProcesses: (handOver: unknown) => {
    jobs.handed.push(handOver);
  },
  listBackgroundProcesses: () => jobs.running as never,
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
let chatMessages: SessionMessage.WithParts[];

beforeEach(async () => {
  counter += 1;
  sent.events = [];
  jobs.handed = [];
  jobs.running = [];
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-fork-"));
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
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  chatSessionId = StoreId.newSessionId();
  const chatId = chatFor(
    chatSessionId,
    ChatIdSchema.parse(`2026-10-06-files-${counter}`),
  );
  chatMessages = conversation(chatSessionId);
  context = {
    // The `bash` part `task new` runs in: the last call of the reply in
    // flight.
    callPartId: callOf(chatMessages).metadata.id,
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
  for (const message of chatMessages) {
    const saved = await Store.saveMessageWithParts(message, chatId);
    if (saved.isErr()) {
      throw saved.error;
    }
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(rootDir, { force: true, recursive: true });
});

/**
 * A chat mid-turn: its baseline, the user's ask, a finished command, and the
 * reply in flight whose last call is the `task new` itself, still unanswered.
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
        agentName: "instrument" as const,
        contextVersion: SESSION_CONTEXT_VERSION,
        createdAt,
        realRole: "system" as const,
        sessionId,
      },
      parts: [
        {
          metadata: meta(id),
          text: instrumentAgent.systemPrompt(),
          type: "text",
        },
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
            command: "task new --name 'Rename photos'",
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

/** The `task new` call of the reply in flight at the conversation's end. */
function callOf(messages: SessionMessage.WithParts[]) {
  const call = messages.at(-1)?.parts.find((part) => part.type === "tool-bash");
  if (!call) {
    throw new Error("the conversation ends on a fork call");
  }
  return call;
}

async function fork(args: string[] = []) {
  const handOffs: HandOff[] = [];
  const result = await withHandOffs(handOffs, () =>
    runNew(
      ["--name", "Rename photos", ...args],
      context,
      encodeUtf8ToBytes(
        `Batch ${counter}: rename every photo in Downloads by its date taken.`,
      ),
    ),
  );
  return { handOffs, result };
}

function forkId(handOffs: HandOff[]): StoreId.Session {
  return StoreId.SessionSchema.parse(handOffs[0]?.taskId);
}

function started() {
  const start = sent.events.find(
    (
      event,
    ): event is {
      type: "createSession";
      value: {
        id: TaskId;
        message: SessionMessage.UserWithParts;
        sessionId: StoreId.Session;
      };
    } =>
      typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "createSession",
  );
  if (!start) {
    throw new Error("the task did not start");
  }
  return start.value;
}

describe("task new", () => {
  it("starts a session in the chat's store, carrying on from before the step that started it", async () => {
    const { handOffs, result } = await fork();
    expect(result.exitCode).toBe(0);
    expect(handOffs.map((handOff) => handOff.kind)).toEqual(["created"]);
    const id = forkId(handOffs);

    const session = (
      await Store.getSession(id, context.chatId)
    )._unsafeUnwrap();
    // The last message the step that called `task new` was sent: the
    // finished `ls`, not the reply still in flight.
    expect(session).toMatchObject({
      forkedAtMessageId: chatMessages[2]?.id,
      parentId: chatSessionId,
      status: "running",
      title: "Rename photos",
    });
    // Not one of the chat's own sessions, and no record or folder of its own.
    expect(
      (await Store.getSessions(context.chatId))
        ._unsafeUnwrap()
        .map((one) => one.id),
    ).toEqual([chatSessionId]);
    expect(await fs.readdir(taskDir(context.chatId))).not.toContain("tasks");

    const start = started();
    expect(start).toMatchObject({ id: context.chatId, sessionId: id });
    // The chat's words, not the user's: no text of the user's, and no folder
    // list the conversation it carries on from already gives.
    const { parts } = start.message;
    expect(parts.filter((part) => part.type === "text")).toEqual([]);
    expect(parts.some((part) => part.type === "data-attachments")).toBe(false);
    expect(parts.find((part) => part.type === "data-fromChat")).toMatchObject({
      data: {
        kind: "assignment",
        text: `Batch ${counter}: rename every photo in Downloads by its date taken.`,
      },
    });
  });

  it("reads the chat's messages as its own history, copying none", async () => {
    const { handOffs } = await fork();
    const id = forkId(handOffs);
    (
      await Store.saveMessageWithParts(started().message, context.chatId)
    )._unsafeUnwrap();

    const history = (
      await Store.getMessagesWithParts({
        sessionId: id,
        taskId: context.chatId,
      })
    )._unsafeUnwrap();
    expect(history.map((message) => message.id)).toEqual([
      ...chatMessages.slice(0, 3).map((message) => message.id),
      started().message.id,
    ]);
    // Still the chat's, filed under its session.
    expect(
      history
        .slice(0, 3)
        .every((message) => message.metadata.sessionId === chatSessionId),
    ).toBe(true);
    const own = (
      await Store.getMessagesWithParts({
        inherited: false,
        sessionId: id,
        taskId: context.chatId,
      })
    )._unsafeUnwrap();
    expect(own.map((message) => message.id)).toEqual([started().message.id]);
  });

  it("carries on from before its step even once its call was answered and a newer step followed", async () => {
    // A call that ran past its yield is answered "still running in the
    // background" while the chat goes on; a task that read that answer would
    // take its own start for the work already under way.
    const last = chatMessages.at(-1);
    if (last?.role !== "assistant") {
      throw new Error("the conversation ends on a reply");
    }
    const answered: SessionMessage.WithParts = {
      ...last,
      parts: last.parts.map(
        (part): SessionMessagePart.Type =>
          part.type === "tool-bash"
            ? {
                input: {
                  command: "task new --name 'Rename photos'",
                  explanation: "Forking",
                  yieldMs: 1000,
                },
                metadata: { ...part.metadata, endedAt: new Date() },
                output: {
                  command: "task new --name 'Rename photos'",
                  commands: ["task new --name 'Rename photos'"],
                  durationMs: 1000,
                  omittedBytes: 0,
                  output: "",
                  processId: "bg_1",
                },
                state: "output-available",
                toolCallId: part.toolCallId,
                type: "tool-bash",
              }
            : part,
      ),
    };
    (
      await Store.saveMessageWithParts(answered, context.chatId)
    )._unsafeUnwrap();
    const newerId = StoreId.newMessageId();
    (
      await Store.saveMessageWithParts(
        {
          ...answered,
          id: newerId,
          parts: answered.parts
            .filter((part) => part.type === "text")
            .map((part) => ({
              ...part,
              metadata: {
                ...part.metadata,
                id: StoreId.newPartId(),
                messageId: newerId,
              },
            })),
        },
        context.chatId,
      )
    )._unsafeUnwrap();

    const { handOffs } = await fork();
    expect(
      (await Store.getSession(forkId(handOffs), context.chatId))._unsafeUnwrap()
        .forkedAtMessageId,
    ).toBe(chatMessages[2]?.id);
  });

  it("says it started by its handle, with nothing of a task folder", async () => {
    const first = await fork();
    expect(first.result.stdout).toContain('Started task t1 ("Rename photos")');
    expect(first.result.stdout).not.toContain("/tasks");
    // Handed out in the order the chat starts them, and kept.
    const second = await fork();
    expect(second.result.stdout).toContain("Started task t2");
    expect(
      (
        await Store.getSession(forkId(first.handOffs), context.chatId)
      )._unsafeUnwrap().handle,
    ).toBe("t1");
  });

  it("hands it a command of the chat's still running, to wait on", async () => {
    jobs.running = [
      { id: "bg_1", status: "running" },
      { id: "bg_2", status: "exited" },
    ];
    const { handOffs } = await fork(["--job", "%1"]);
    const id = forkId(handOffs);
    expect(jobs.handed).toMatchObject([
      { from: chatSessionId, ids: ["bg_1"], to: id, toTaskId: context.chatId },
    ]);
    const start = JSON.stringify(sent.events.at(-1));
    expect(start).toContain("yours now under the same ids: bg_1");

    await expect(fork(["--job", "bg_2"])).rejects.toThrow(
      /--job bg_2 is not a command of yours still running/,
    );
  });

  it("refuses the flags that would hand a fork what it already has", async () => {
    for (const flag of [
      ["--fresh"],
      ["--folder", "/mnt/x"],
      ["--file", "a"],
      ["--app", "linear"],
    ]) {
      await expect(fork(flag)).rejects.toThrow(/unknown flag/);
    }
  });

  it("sends the request that started it as the prefix of its first one", async () => {
    const model = createMockAIGatewayModel();
    const request = async (sessionId: StoreId.Session) =>
      (
        await prepareModelMessages({
          agent: instrumentAgent,
          model,
          sessionId,
          signal: new AbortController().signal,
          taskId: context.chatId,
        })
      )
        ._unsafeUnwrap()
        // Where the cache breakpoints sit moves with the newest message, and
        // is a request option rather than bytes of the prefix.
        .map(({ providerOptions: _options, ...message }) => message);
    // What the chat sent for the step that called `task new`: everything
    // before the reply that step wrote.
    const reply = chatMessages.at(-1);
    if (!reply) {
      throw new Error("the conversation is empty");
    }
    (
      await Store.removeMessage(reply.id, chatSessionId, context.chatId)
    )._unsafeUnwrap();
    const chat = await request(chatSessionId);
    (await Store.saveMessageWithParts(reply, context.chatId))._unsafeUnwrap();

    const { handOffs } = await fork();
    // The session machine saves the assignment before the first request.
    (
      await Store.saveMessageWithParts(started().message, context.chatId)
    )._unsafeUnwrap();
    const forked = await request(forkId(handOffs));

    // System prompt, the ask, and the `ls` call and its result.
    expect(chat.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
    expect(forked.slice(0, chat.length)).toEqual(chat);
    expect(forked).toHaveLength(chat.length + 1);
    // What the model reads for the chat's words: the fork's note, then the
    // assignment, with nothing fencing it as the user's.
    const assignment = JSON.stringify(forked.at(-1));
    expect(assignment).toContain(
      "Everything above is this conversation as it stood",
    );
    expect(assignment).toContain("named for this job");
    expect(assignment).toContain("Your assignment:\\nBatch");
    expect(assignment).not.toContain("<user_message>");
    expect(assignment).not.toContain("attached_folders");
  });

  it("leaves the chat's folders alone, reaching them as they stand", async () => {
    const before = (await getTaskState(taskDir(context.chatId)))
      .attachedFolders;
    await fork();
    expect(
      (await getTaskState(taskDir(context.chatId))).attachedFolders,
    ).toEqual(before);
  });
});

describe("task folder", () => {
  it("gives the chat a folder inside one it reaches, which its tasks reach too", async () => {
    await fork();
    const writable = Object.values(await folderReach(context.chatId)).find(
      (folder) => effectiveFolderAccess(folder) === "read-write",
    );
    if (!writable) {
      throw new Error("the chat reaches no writable folder");
    }
    const inside = path.join(writable.path, "Sales");
    await fs.mkdir(inside, { recursive: true });
    const result = await subcommandRunner(folderSubcommand, "task folder")(
      ["--add", `/mnt/${writable.mountName}/Sales`],
      context,
    );
    expect(result.stdout).toContain("You now have");
    expect(
      Object.values(await folderReach(context.chatId)).map(
        (folder) => folder.path,
      ),
    ).toContain(inside);
  });
});
