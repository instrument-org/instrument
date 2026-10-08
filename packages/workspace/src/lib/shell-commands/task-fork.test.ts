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
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
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
import { chatPathOfWorkDir, workDir } from "../work-dir";
import { effectiveFolderAccess } from "../workspace-fs-layout";
import { getTaskState, setTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { type TaskCommandContext } from "./task/context";
import { folderSubcommand } from "./task/folder";
import { newSubcommand, withoutForkingCall } from "./task/fork";
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

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: () =>
    Promise.resolve({ ok: true, value: createMockAIGatewayModel() }) as never,
}));

let counter = 0;
let rootDir: string;
let context: TaskCommandContext;
let chatSessionId: StoreId.Session;

beforeEach(async () => {
  counter += 1;
  sent.events = [];
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

async function fork(args: string[] = []) {
  const handOffs: HandOff[] = [];
  const result = await withHandOffs(handOffs, () =>
    runNew(
      ["--name", "Rename photos", ...args],
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

describe("task new", () => {
  it("starts the agent on the chat's conversation, then the directive", async () => {
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
    expect(start?.value).toMatchObject({ id });
    const directive = JSON.stringify(start?.value);
    expect(directive).toContain(
      "as a task: you, carrying on in the background",
    );
    expect(directive).toContain("named for this job");
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

  it("says it started, with nothing of a task folder", async () => {
    const { handOffs, result } = await fork();
    expect(result.stdout).toContain(`Started task ${forkId(handOffs)}`);
    expect(result.stdout).not.toContain("/tasks");
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
          agent: instrumentAgent,
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
      "Everything above is this conversation as it stood",
    );
  });

  it("reaches exactly the chat's folders, and leaves them alone", async () => {
    const reach = Object.values(await folderReach(context.chatId));
    const before = (await getTaskState(taskDir(context.chatId)))
      .attachedFolders;

    const { handOffs } = await fork();

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
});

describe("withoutForkingCall", () => {
  // The fork call ran past its yield and was answered "still running in the
  // background": the fork must not inherit that as work under way.
  it("leaves out the forking call even once it was answered as backgrounded", () => {
    const messages = conversation(chatSessionId);
    const last = messages.at(-1);
    if (last?.role !== "assistant") {
      throw new Error("the conversation ends on a reply");
    }
    const backgrounded: SessionMessage.WithParts = {
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
                metadata: {
                  ...part.metadata,
                  endedAt: new Date("2026-10-06T10:00:01.000Z"),
                },
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
    const kept = withoutForkingCall([...messages.slice(0, -1), backgrounded]);
    expect(kept).toHaveLength(messages.length);
    expect(kept.at(-1)?.parts.map((part) => part.type)).toEqual(["text"]);
    // Earlier steps are the cached prefix and stay as they were.
    expect(kept.slice(0, -1)).toEqual(messages.slice(0, -1));
  });

  it("drops the step whole when the forking call was all of it", () => {
    const messages = conversation(chatSessionId);
    const last = messages.at(-1);
    if (last?.role !== "assistant") {
      throw new Error("the conversation ends on a reply");
    }
    const onlyCall = {
      ...last,
      parts: last.parts.filter((part) => part.type === "tool-bash"),
    };
    expect(withoutForkingCall([...messages.slice(0, -1), onlyCall])).toEqual(
      messages.slice(0, -1),
    );
  });
});

describe("task folder", () => {
  it("gives the chat and its running forks a folder inside one it reaches", async () => {
    const { handOffs } = await fork();
    const id = forkId(handOffs);
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
    const held = (dir: TaskId) =>
      getTaskState(taskDir(dir)).then((state) =>
        Object.values(state.attachedFolders ?? {}).map((folder) => folder.path),
      );
    expect(await held(context.chatId)).toContain(inside);
    expect(await held(id)).toContain(inside);
  });
});
