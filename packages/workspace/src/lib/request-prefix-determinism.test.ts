import { AIGatewayProviderConfig } from "@instrument-org/ai-gateway/schemas";
import { noteReportedContextLength } from "@instrument-org/ai-gateway/context-windows";
import { asSchema, type ModelMessage } from "ai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type AnyAgent } from "../agents/types";
import { instrumentAgent } from "../agents/instrument";
import { createContextMessage, getSystemInfoText } from "../agents/shared";
import { HANDOFF_NOTES_FILE_NAME } from "../constants";
import { ChatIdSchema } from "../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { type SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { type ToolName } from "../tools/types";
import { type WorkspaceConfig } from "../types";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";
import { usableContextTokens } from "./context-budget";
import { currentEnvironment } from "./environment";
import { initializeChat } from "./initialize-chat";
import { prepareModelMessages } from "./prepare-model-messages";
import { chatDir, forgetChatFolders } from "./record-folders";
import { ChatRecords, installChatRecords } from "./records/chat-records";
import { newDeviceId } from "./records/device-id";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";
import { writeUploadedAttachments } from "./write-uploaded-attachments";

/**
 * The bytes a request sends for everything before the newest user turn, and
 * its tool definitions, are a function of the chat's records alone: the same
 * on another computer, after the workspace moves, after a provider is
 * connected, after a restart, and after the files the agent reads live
 * (handoff notes, a topic, a skill, an app, a memory) are edited.
 *
 * One chat is written on one computer and its request rendered there, then
 * the workspace is copied to another computer (another root, home folder,
 * platform, provider list and reported context window, and a fresh records
 * service, as a restart has) and rendered again, and once more after those
 * files change. Each letter checks the part of the request one cause of
 * drift used to reach.
 */

const chatId = ChatIdSchema.parse("prefix-guard");
const sessionId = StoreId.newSessionId();
const model = createMockAIGatewayModel({ contextLength: 200_000 });

interface Computer {
  config: WorkspaceConfig;
  home: string;
  platform: NodeJS.Platform;
  /** The window the provider reported for the model, if it did. */
  reportedWindow?: number;
  root: string;
}

interface Rendered {
  prefix: ModelMessage[];
  tools: string;
}

const base = getWorkspaceConfig();
const originalPlatform = process.platform;
let records: ChatRecords | undefined;
let rootA = "";
let rootB = "";
let machineA = "";
let machineB = "";
const renders: Record<"edited" | "first" | "moved", Rendered> = {
  edited: { prefix: [], tools: "" },
  first: { prefix: [], tools: "" },
  moved: { prefix: [], tools: "" },
};

function computer(
  root: string,
  machine: string,
  rest: Omit<Computer, "config" | "root"> & {
    providers: AIGatewayProviderConfig.Type[];
  },
): Computer {
  const layout = workspaceLayout(root);
  return {
    config: {
      ...base,
      appsDir: AbsolutePathSchema.parse(layout.appsDir),
      chatsDir: AbsolutePathSchema.parse(layout.chatsDir),
      getAIProviderConfigs: () => rest.providers,
      legacyTasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
      registryDir: AbsolutePathSchema.parse(path.join(root, "registry")),
      rootDir: WorkspaceDirSchema.parse(root),
      runtimeDir: AbsolutePathSchema.parse(path.join(machine, "runtime")),
      systemSkillsDir: AbsolutePathSchema.parse(
        path.join(machine, "system-skills"),
      ),
      userDataDir: AbsolutePathSchema.parse(machine),
      workFoldersDir: AbsolutePathSchema.parse(path.join(machine, "work")),
      workspaceMachineDir: AbsolutePathSchema.parse(machine),
    },
    home: rest.home,
    platform: rest.platform,
    ...(rest.reportedWindow !== undefined && {
      reportedWindow: rest.reportedWindow,
    }),
    root,
  };
}

/** Puts `computer` in place as a freshly started app would find it. */
function boot(on: Computer) {
  setWorkspaceConfig(on.config);
  vi.spyOn(os, "homedir").mockReturnValue(on.home);
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: on.platform,
  });
  forgetChatFolders();
  records = new ChatRecords({
    app: "0.0.0-test",
    device: newDeviceId(),
    dirOf: chatDir,
    fsync: false,
  });
  installChatRecords(records);
  if (on.reportedWindow !== undefined) {
    noteReportedContextLength(model, on.reportedWindow);
  }
}

async function shutDown() {
  installChatRecords(undefined);
  await records?.dispose();
  records = undefined;
}

/** A baseline as the agent writes one: the computer it was written on, in its own words. */
const agent: AnyAgent = {
  ...instrumentAgent,
  getMessages: async ({ sessionId: id }) => {
    const now = new Date(0);
    const environment = await currentEnvironment(chatId);
    return [
      createContextMessage({
        agentName: "instrument",
        environment,
        now,
        sessionId: id,
        textParts: [getSystemInfoText({ environment, network: "" })],
      }),
    ];
  },
};

async function render(): Promise<Rendered> {
  const toolDefinitions = await Promise.all(
    (await agent.getTools()).map(async (tool) => {
      const definition = await tool.aiSDKTool({ chatId, model });
      return {
        description: definition.description,
        name: tool.name,
        schema: await asSchema(definition.inputSchema).jsonSchema,
      };
    }),
  );
  const messages = (
    await prepareModelMessages({
      agent,
      chatId,
      model,
      sessionId,
      signal: AbortSignal.timeout(30_000),
    })
  )._unsafeUnwrap();
  // What follows the newest user turn, and the notes said for one request
  // only, are not part of what a provider caches.
  const kept = messages.filter(
    (message) => message.providerOptions?.instrument === undefined,
  );
  const newestUser = kept.findLastIndex((message) => message.role === "user");
  return {
    prefix: kept.slice(0, newestUser),
    tools: JSON.stringify(toolDefinitions),
  };
}

function partMetadata(messageId: StoreId.Message) {
  return {
    createdAt: new Date(0),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  };
}

function textPart(messageId: StoreId.Message, text: string) {
  return {
    metadata: partMetadata(messageId),
    state: "done" as const,
    text,
    type: "text" as const,
  };
}

function user(
  text: string,
  parts: SessionMessagePart.Type[] = [],
  id = StoreId.newMessageId(),
): SessionMessage.UserWithParts {
  return {
    id,
    metadata: { createdAt: new Date(0), sessionId },
    parts: [textPart(id, text), ...parts],
    role: "user",
  };
}

function assistant(
  parts: (id: StoreId.Message) => SessionMessagePart.Type[],
): SessionMessage.AssistantWithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt: new Date(0),
      finishReason: "stop",
      modelId: model.canonicalId,
      providerId: model.providerId,
      sessionId,
    },
    parts: parts(id),
    role: "assistant",
  };
}

function toolPart(
  id: StoreId.Message,
  type: `tool-${ToolName}`,
  toolCallId: string,
  input: unknown,
  output: unknown,
) {
  return SessionMessagePart.coerce({
    input,
    metadata: { ...partMetadata(id), endedAt: new Date(0) },
    output,
    state: "output-available",
    toolCallId,
    type,
  });
}

/** A real, decodable grayscale PNG of the given size: one flat color. */
function flatPng(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(0, 9); // grayscale
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let row = 0; row < height; row++) {
    rows[row * (width + 1)] = 0; // no filter
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function imageRead(id: StoreId.Message, toolCallId: string, png: Buffer) {
  return toolPart(
    id,
    "tool-read_file",
    toolCallId,
    { filePath: "./picture.png" },
    {
      base64Data: png.toString("base64"),
      filePath: "./picture.png",
      mimeType: "image/png",
      modifiedAt: 0,
      state: "image",
    },
  );
}

/** The files the agent reads live, which a request must not depend on. */
async function writeLiveFiles(root: string, version: string) {
  const layout = workspaceLayout(root);
  const files: [file: string, text: string][] = [
    [path.join(chatDir(chatId), HANDOFF_NOTES_FILE_NAME), "# Notes"],
    [path.join(layout.topicsDir, "Work", "TOPIC.md"), "---\nid: work\n---\n"],
    [path.join(root, "Skills", "demo", "SKILL.md"), "---\nname: demo\n---\n"],
    [path.join(layout.appsDir, "Demo", "APP.md"), "---\nid: demo\n---\n"],
    [path.join(layout.memoryDir, "note.md"), "Likes tea."],
  ];
  for (const [file, text] of files) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${text}\n${version}\n`);
  }
}

async function writeChat() {
  (await initializeChat({ chatId, sessionId }))._unsafeUnwrap();
  const save = async (message: SessionMessage.WithParts) =>
    (await ChatWrites.saveMessageWithParts(message, chatId))._unsafeUnwrap();

  // [A] An upload and a file attached from the workspace, by the writer.
  const notes = path.join(rootA, "Notes", "plan.md");
  await fs.mkdir(path.dirname(notes), { recursive: true });
  await fs.writeFile(notes, "plan");
  const attachedId = StoreId.newMessageId();
  const attachments = (
    await writeUploadedAttachments({
      files: [
        {
          content: Buffer.from("png").toString("base64"),
          filename: "photo.png",
          mimeType: "image/png",
          size: 3,
        },
        {
          filename: "plan.md",
          mimeType: "text/markdown",
          path: AbsolutePathSchema.parse(notes),
          size: 4,
        },
      ],
      messageId: attachedId,
      recordDir: chatDir(chatId),
      sessionId,
    })
  )._unsafeUnwrap().part;
  await save(user("[A] look at these", [attachments], attachedId));

  // [C] History before the rollover the session recorded.
  await save(assistant((id) => [textPart(id, "pre-boundary work")]));
  await save(user("[C] keep going"));
  const boundary = assistant((id) => [textPart(id, "more pre-boundary work")]);
  await save(boundary);

  // [F] Paths a chat on Windows stored, spelled as its shell spelled them.
  const fId = StoreId.newMessageId();
  await save(
    user(
      "[F] these folders",
      [
        {
          data: {
            added: [
              {
                agentPath: "/c/Users/sam/Projects",
                path: "C:\\Users\\sam\\Projects",
              },
            ],
            removed: [],
          },
          metadata: partMetadata(fId),
          type: "data-folderChanges",
        },
        {
          data: {
            chosen: [
              {
                agentPath: "/c/Users/sam/Projects/a.txt",
                kind: "file",
                name: "a.txt",
                path: "C:\\Users\\sam\\Projects\\a.txt",
              },
            ],
            file: {
              agentPath: "/c/Users/sam/notes.txt",
              name: "notes.txt",
              path: "C:\\Users\\sam\\notes.txt",
            },
            screen: "file",
          },
          metadata: partMetadata(fId),
          type: "data-viewContext",
        },
      ] as SessionMessagePart.Type[],
      fId,
    ),
  );
  await save(
    assistant((id) => [
      toolPart(
        id,
        "tool-ask_permission",
        "call_ask",
        { explanation: "x", kind: "folder", reason: "x", target: "x" },
        {
          agentTarget: "/c/Users/sam/Secret",
          kind: "folder",
          state: "asked",
          target: "C:\\Users\\sam\\Secret",
        },
      ),
    ]),
  );

  // [G] The home folder of the computer that granted it.
  const gId = StoreId.newMessageId();
  await save(
    user(
      "[G] my home",
      [
        {
          data: {
            added: [{ agentPath: "/Users/alice", path: "/Users/alice" }],
            removed: [],
          },
          metadata: partMetadata(gId),
          type: "data-folderChanges",
        },
      ] as SessionMessagePart.Type[],
      gId,
    ),
  );

  // [B] A skill loaded on Windows.
  await save(
    assistant((id) => [
      toolPart(
        id,
        "tool-load_skill",
        "call_skill",
        { explanation: "x", name: "docx" },
        {
          content: "# Docx",
          contentTruncated: false,
          files: ["scripts/a.py"],
          name: "docx",
          origin: "instrument",
          skillDir: "C:\\Users\\sam\\AppData\\Instrument\\skills\\docx",
          skillFolder: "/c/Users/sam/AppData/Instrument/skills/docx",
          skillName: "docx",
          state: "success",
          truncated: false,
        },
      ),
    ]),
  );

  // [H] Images read back from blobs, one over the model's budget.
  await save(
    assistant((id) => [
      imageRead(id, "call_small", flatPng(64, 64)),
      imageRead(id, "call_large", flatPng(3000, 2000)),
    ]),
  );

  await save(user("[latest] what now?"));

  // [C] Rolled over under the catalog's window.
  const session = (
    await ChatReads.session({ chatId, sessionId })
  )._unsafeUnwrap();
  (
    await ChatWrites.saveSession(
      {
        ...session,
        rolledOverAfterMessageId: boundary.id,
        rolledOverUnderUsableTokens: usableContextTokens(200_000),
      },
      chatId,
    )
  )._unsafeUnwrap();
}

beforeAll(async () => {
  rootA = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pa-")));
  rootB = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pb-")));
  machineA = await fs.mkdtemp(path.join(os.tmpdir(), "ma-"));
  machineB = await fs.mkdtemp(path.join(os.tmpdir(), "mb-"));
  const first = computer(rootA, machineA, {
    home: "/Users/alice",
    platform: "darwin",
    providers: [],
  });
  const second = computer(rootB, machineB, {
    home: "/Users/bob",
    platform: "win32",
    providers: [
      AIGatewayProviderConfig.Schema.parse({
        apiKey: "key",
        cacheIdentifier: "guard",
        id: model.params.providerConfigId,
        type: "openai",
      }),
    ],
    reportedWindow: 1_000_000,
  });

  boot(first);
  await writeChat();
  await writeLiveFiles(rootA, "first");
  renders.first = await render();
  await shutDown();

  await fs.rm(rootB, { force: true, recursive: true });
  await fs.cp(rootA, rootB, { recursive: true });
  boot(second);
  renders.moved = await render();
  await shutDown();

  boot(second);
  await writeLiveFiles(rootB, "edited");
  renders.edited = await render();
  await shutDown();
}, 60_000);

afterAll(async () => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: originalPlatform,
  });
  vi.restoreAllMocks();
  setWorkspaceConfig(base);
  forgetChatFolders();
  for (const root of [rootA, rootB, machineA, machineB]) {
    await fs.rm(root, { force: true, recursive: true });
  }
});

/** The messages in the prefix that mention `marker`, as sent. */
function mentioning(rendered: Rendered, marker: string) {
  return rendered.prefix
    .filter((message) => JSON.stringify(message).includes(marker))
    .map((message) => JSON.stringify(message));
}

describe("the request prefix", () => {
  it.each([
    ["A: upload notes", "[A]"],
    ["B: skill results", "call_skill"],
    ["F: paths as the shell spelled them", "[F]"],
    ["F: a permission card's path", "call_ask"],
    ["G: the home folder's name", "[G]"],
    ["H: images over budget", "call_large"],
  ])("%s", (_name, marker) => {
    const first = mentioning(renders.first, marker);
    expect(first.length).toBeGreaterThan(0);
    expect(mentioning(renders.moved, marker)).toEqual(first);
    expect(mentioning(renders.edited, marker)).toEqual(first);
  });

  it("C: keeps the rollover decided once", () => {
    const shape = (rendered: Rendered) =>
      rendered.prefix.map((message) => message.role);
    expect(shape(renders.moved)).toEqual(shape(renders.first));
    expect(mentioning(renders.moved, "pre-boundary work")).toEqual(
      mentioning(renders.first, "pre-boundary work"),
    );
  });

  it("D: sends the same tool definitions", () => {
    expect(renders.moved.tools).toEqual(renders.first.tools);
    expect(renders.edited.tools).toEqual(renders.first.tools);
  });

  it("is byte-identical as a whole", () => {
    const first = JSON.stringify(renders.first.prefix);
    expect(JSON.stringify(renders.moved.prefix)).toEqual(first);
    expect(JSON.stringify(renders.edited.prefix)).toEqual(first);
  });
});
