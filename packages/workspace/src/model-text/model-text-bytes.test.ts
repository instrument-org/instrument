import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { instrumentAgent } from "../agents/instrument";
import { getSystemInfoText, getUserText } from "./context/context-message";
import { STOPPED_TOOL_CALL_ERROR_TEXT } from "../constants";
import * as agentBrowserGuide from "./guides/agent-browser-guide";
import * as appEvent from "./notes/app-event-model-text";
import * as asks from "./notes/asks-model-text";
import * as availableSkillsContext from "./context/available-skills-context";
import * as backgroundProcesses from "./notes/background-processes-model-text";
import * as branchedFrom from "./notes/branched-from-model-text";
import * as browserStatus from "./notes/browser-status-model-text";
import * as buildFoldersText from "./context/build-folders-text";
import * as contextBudgetNotice from "./request/context-budget-notice";
import * as dateChange from "./notes/date-change-model-text";
import * as environmentModelText from "./context/environment-model-text";
import * as folderChanges from "./notes/folder-changes-model-text";
import * as fromChat from "./notes/from-chat-model-text";
import * as handOff from "./notes/hand-off-model-text";
import * as ignoredBuildsNote from "./commands/ignored-builds-note";
import * as jobEvent from "./notes/job-event-model-text";
import { MAC_APPS } from "../lib/mac-apps/apps";
import * as macAppGuide from "./guides/mac-app-guide";
import * as maxSteps from "./notes/max-steps-model-text";
import * as memory from "./notes/memory-model-text";
import * as messageGap from "./notes/message-gap-model-text";
import * as modelChange from "./notes/model-change-model-text";
import * as nativeSandboxRefusals from "./commands/package-scope-note";
import * as outputLimit from "./notes/output-limit-model-text";
import * as pageTakeover from "./notes/page-takeover-model-text";
import * as permissionAnswer from "./notes/permission-answer-model-text";
import * as project from "./notes/project-model-text";
import * as questionAnswer from "./notes/question-answer-model-text";
import { ChatWrites } from "../lib/chat-writes";
import { contextRolloverNotice } from "./request/context-rollover-notice";
import { sessionOfChat } from "../lib/record-folders";
import { turnNoteFor } from "../lib/turn-note";
import * as setupNews from "./notes/setup-news-model-text";
import * as appCommand from "./commands/app-command";
import * as instrumentCommand from "./commands/instrument-command";
import * as memoryCommand from "./commands/memory-command";
import * as taskCommand from "./commands/task-command";
import * as windowCommand from "./commands/window-command";
import * as xCommand from "./commands/x-command";
import * as signInProgress from "./notes/sign-in-progress-model-text";
import * as signedIn from "./notes/signed-in-model-text";
import * as skillChanges from "./notes/skill-changes-model-text";
import * as stoppedToolCall from "./notes/stopped-tool-call-model-text";
import * as systemNote from "./notes/system-note";
import * as taskEvent from "./notes/task-event-model-text";
import * as undoneChanges from "./notes/undone-changes-model-text";
import { DATA_PART_SAMPLES } from "../lib/transcript/developer-note-samples";
import { TURN_NOTE } from "./request/turn-notes";
import * as viewContext from "./notes/view-context-model-text";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import * as workspaceInstructions from "./notes/workspace-instructions-model-text";
import { ChatIdSchema } from "../schemas/chat-id";
import { type Environment } from "../schemas/environment";
import { type MountedFolder as Folder } from "../schemas/mounted-folder";
import { SessionMessage } from "../schemas/session/message";
import { SessionMessageDataPart } from "../schemas/session/message-data-part";
import { SessionMessagePart } from "../schemas/session/message-part";
import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { initializeTestChat } from "../test/helpers/initialize-test-chat";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { MOCK_WORKSPACE_ROOT } from "../test/helpers/mock-workspace-root";

/**
 * The bytes the model reads, pinned whole: the system prompt, the session's
 * context message, every note a stored data part renders onto the history,
 * the one-request notes, the guides and command descriptions, and every
 * exported text constant of the modules that hold model text. A provider
 * caches the request prefix, so any byte that moves here misses that cache
 * for every chat on its next turn; a change to this file's snapshot has to
 * be one that was meant. The tool definitions are pinned by
 * `tools/tool-definitions.test.ts`.
 */

// Shell paths are spelled the Windows way there (`/c/Users/...`), which the
// fixtures' paths would come out in; the text around them is the same.
const WINDOWS = process.platform === "win32";

const state = vi.hoisted(() => ({
  folders: true,
  pythonReady: true,
}));

vi.mock(import("../lib/get-current-date"), () => ({
  getCurrentDate: () => new Date("2026-11-08T15:04:00.000Z"),
}));

vi.mock(import("../lib/python-base"), async (original) => ({
  ...(await original()),
  pythonBaseReady: () => state.pythonReady,
}));

vi.mock(import("../lib/environment"), async (original) => ({
  ...(await original()),
  currentEnvironment: () => Promise.resolve(ENVIRONMENT),
}));

vi.mock(import("../lib/chat/folder-reach"), async (original) => {
  const { MountedFolder } = await import("../schemas/mounted-folder");
  return {
    ...(await original()),
    folderReach: () =>
      Promise.resolve<Record<string, Folder.Type>>(
        state.folders
          ? {
              home: MountedFolder.Schema.parse({
                access: "read-write",
                id: "home",
                path: "/Users/mac-user",
              }),
              notes: MountedFolder.Schema.parse({
                access: "read-only",
                id: "notes",
                path: "/Users/mac-user/Notes",
              }),
            }
          : {},
      ),
  };
});

vi.mock(import("../lib/skills"), async (original) => ({
  ...(await original()),
  findSkills: () => Promise.resolve(SKILLS),
}));

const ENVIRONMENT: Environment = {
  appsFolder: "/Users/mac-user/Instrument/Apps",
  commands: "Your shell on this computer also has `ps`.",
  computer: "A test Mac (macOS 27.0)",
  homeFolder: "/Users/mac-user",
  imageOptions: "Sizes: 1024x1024.",
  outputFolder: "/Users/mac-user/Instrument/Chats/Test",
  platform: "darwin",
  timeZone: "America/Los_Angeles",
  workspaceSkillsFolder: "/Users/mac-user/Instrument/Skills",
};

const skill = (name: string, description: string) => ({
  aliases: [name],
  compatibility: undefined,
  content: `# ${name}`,
  description,
  id: `workspace:${name}`,
  modelInvocable: true,
  name,
  qualifiedName: name,
  skillDir: AbsolutePathSchema.parse(
    `/Users/mac-user/Instrument/Skills/${name}`,
  ),
  source: "workspace" as const,
  sourceId: "workspace" as const,
  title: name,
  userInvocable: true,
});

const SKILLS = [
  skill("pdf", "Reads and writes PDF files."),
  skill("slides", "Makes slide decks."),
];

const ID = /\b(?:msg|ses|prt|part)_[0-9A-Z]{26}\b|\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
const scrub = (text: string) => text.replaceAll(ID, "<id>");

/** Every export of a module that is not code, as it would reach the model. */
function constantsOf(module: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(module)
      .filter(([, value]) => typeof value !== "function")
      .toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

const MODULES = {
  agentBrowserGuide,
  appCommand,
  appEvent,
  asks,
  availableSkillsContext,
  backgroundProcesses,
  branchedFrom,
  browserStatus,
  buildFoldersText,
  contextBudgetNotice,
  dateChange,
  environmentModelText,
  folderChanges,
  fromChat,
  handOff,
  ignoredBuildsNote,
  instrumentCommand,
  jobEvent,
  macAppGuide,
  maxSteps,
  memory,
  memoryCommand,
  messageGap,
  modelChange,
  nativeSandboxRefusals,
  outputLimit,
  pageTakeover,
  permissionAnswer,
  project,
  questionAnswer,
  setupNews,
  signInProgress,
  signedIn,
  skillChanges,
  stoppedToolCall,
  systemNote,
  taskCommand,
  taskEvent,
  // LENGTH_NOTE is pinned through turnNoteFor, below.
  turnNote: { TURN_NOTE },
  viewContext,
  windowCommand,
  workspaceInstructions,
  xCommand,
};

describe.skipIf(WINDOWS)("the system prompt", () => {
  it("is pinned", () => {
    expect(instrumentAgent.systemPrompt()).toMatchSnapshot();
  });
});

describe.skipIf(WINDOWS)("the context message", () => {
  const chatId = ChatIdSchema.parse("model-text-bytes");
  let root = "";
  const base = getWorkspaceConfig();

  beforeEach(async () => {
    process.env.TZ = "America/Los_Angeles";
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "model-text-bytes-")),
    );
    vi.spyOn(os, "homedir").mockReturnValue(root);
    createMockChatConfigForDir(
      path.join(root, ".instrument", "chats", chatId),
      {
        unplaced: true,
      },
    );
    await initializeTestChat({ chatId });
  });

  afterEach(async () => {
    setWorkspaceConfig(base);
    state.folders = true;
    state.pythonReady = true;
    vi.restoreAllMocks();
    await fs.rm(root, { force: true, recursive: true });
  });

  async function rendered(model = createMockAIGatewayModel()) {
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) throw new Error("missing chat session");
    const messages = await instrumentAgent.getMessages({
      chatId,
      model,
      sessionId,
    });
    return messages.map((message) =>
      message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .replaceAll(MOCK_WORKSPACE_ROOT, "<workspace>"),
    );
  }

  it("is pinned for a signed-in user with folders", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      getUser: () =>
        Promise.resolve({ email: "mac-user@example.com", name: "Mac User" }),
    });
    expect(await rendered()).toMatchSnapshot();
  });

  it("is pinned for a signed-out user with no folders", async () => {
    state.folders = false;
    state.pythonReady = false;
    expect(
      await rendered(createMockAIGatewayModel({ providerId: "openrouter" })),
    ).toMatchSnapshot();
  });

  it("pins the system information and user lines on their own", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      getUser: () => Promise.resolve({ email: "mac-user@example.com" }),
    });
    expect({
      systemInfo: getSystemInfoText({
        environment: { ...ENVIRONMENT, platform: "win32" },
        network: "<network>",
      }),
      user: await getUserText(),
    }).toMatchSnapshot();
  });

  it("pins the notes a typed turn's first step and a cut-off step are sent with", async () => {
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) throw new Error("missing chat session");
    const save = async (message: SessionMessage.WithParts) =>
      (await ChatWrites.saveMessageWithParts(message, chatId))._unsafeUnwrap();
    const userId = StoreId.newMessageId();
    await save({
      id: userId,
      metadata: { createdAt: new Date(1000), sessionId },
      parts: [
        {
          metadata: {
            createdAt: new Date(1000),
            id: StoreId.newPartId(),
            messageId: userId,
            sessionId,
          },
          state: "done",
          text: "Hello",
          type: "text",
        },
      ],
      role: "user",
    });
    const typed = await turnNoteFor({ chatId, sessionId });
    const replyId = StoreId.newMessageId();
    await save({
      id: replyId,
      metadata: {
        createdAt: new Date(2000),
        finishReason: "length",
        modelId: "mock-model-id",
        providerId: "mock-provider-id",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt: new Date(2000),
            id: StoreId.newPartId(),
            messageId: replyId,
            sessionId,
          },
          state: "done",
          text: "Half a rep",
          type: "text",
        },
      ],
      role: "assistant",
    });
    expect({
      cutOff: await turnNoteFor({ chatId, sessionId }),
      typed,
    }).toMatchSnapshot();
  });
});

describe.skipIf(WINDOWS)("the rollover notice", () => {
  it("pins each shape it takes", () => {
    const notesPath = "/Users/mac-user/.instrument/chats/c/handoff-notes.md";
    expect({
      noNotes: contextRolloverNotice(undefined, notesPath),
      summarized: contextRolloverNotice("Notes.", notesPath, {
        summary: "A summary.",
        transcriptPath: "/Users/mac-user/transcript.md",
      }),
      summarizedNoTranscript: contextRolloverNotice(undefined, notesPath, {
        summary: "A summary.",
        transcriptPath: undefined,
      }),
      withNotes: contextRolloverNotice("Notes.", notesPath),
    }).toMatchSnapshot();
  });
});

describe.skipIf(WINDOWS)("the notes a stored data part renders", () => {
  const sessionId = StoreId.newSessionId();
  const CARRIED = new Set(["maxSteps", "outputLimit", "setupChanges"]);
  const meta = (messageId: StoreId.Message) => ({
    createdAt: new Date(0),
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  });
  const words = (messageId: StoreId.Message, text: string) =>
    ({
      metadata: meta(messageId),
      state: "done",
      text,
      type: "text",
    }) as SessionMessagePart.Type;
  function message(
    role: "assistant" | "user",
    build: (id: StoreId.Message) => SessionMessagePart.Type[],
  ): SessionMessage.WithParts {
    const id = StoreId.newMessageId();
    return {
      id,
      metadata: {
        createdAt: new Date(0),
        sessionId,
        ...(role === "assistant" ? { modelId: "m", providerId: "p" } : {}),
      },
      parts: build(id),
      role,
    } as SessionMessage.WithParts;
  }

  it.each(SessionMessageDataPart.NameSchema.options)("%s", (name) => {
    const part = (id: StoreId.Message) =>
      ({
        data: DATA_PART_SAMPLES[name],
        metadata: meta(id),
        type: `data-${name}`,
      }) as SessionMessagePart.Type;
    const session = CARRIED.has(name)
      ? [
          message("user", (id) => [words(id, "First")]),
          message("assistant", (id) => [words(id, "So far."), part(id)]),
          message("user", (id) => [words(id, "Next")]),
        ]
      : [message("user", (id) => [words(id, "First"), part(id)])];
    const heard = SessionMessage.toUIMessages(session).map((one) =>
      one.parts.map((each) =>
        each.type === "text" ? scrub(each.text) : each.type,
      ),
    );
    expect(heard).toMatchSnapshot();
  });
});

describe.skipIf(WINDOWS)("the builders called directly", () => {
  it("pins each one's text for fixed inputs", () => {
    const messageId = StoreId.newMessageId();
    const tool = (
      extra: Record<string, unknown>,
      stoppedBy?: "agent" | "user",
    ) =>
      SessionMessagePart.coerce({
        input: { command: "ls", explanation: "Listing", yieldMs: 1000 },
        metadata: {
          createdAt: new Date(0),
          id: StoreId.newPartId(),
          messageId,
          sessionId: StoreId.newSessionId(),
          ...(stoppedBy && { stoppedBy }),
        },
        toolCallId: "call-1",
        type: "tool-bash",
        ...extra,
        // Each case adds the state, and the fields that state needs.
      } as unknown as Parameters<typeof SessionMessagePart.coerce>[0]);
    const errorText = (part: SessionMessagePart.Type) =>
      "errorText" in part ? part.errorText : undefined;

    expect({
      agentBrowserGuide: agentBrowserGuide.agentBrowserGuide(),
      agentBrowserGuideFull: agentBrowserGuide.agentBrowserGuide({
        full: true,
      }),
      availableSkills:
        availableSkillsContext.renderAvailableSkillsContext(SKILLS),
      branchedFrom: branchedFrom.branchedFromModelNote(
        DATA_PART_SAMPLES.branchedFrom,
        (hostPath) => `/shell${hostPath}`,
      ),
      contextBudgetExhausted: contextBudgetNotice.contextBudgetNotice(
        {
          occupancySource: "measured",
          occupied: 100_000,
          remaining: 0,
          status: "exhausted",
          usable: 100_000,
        },
        "/Users/mac-user/notes.md",
      ),
      contextBudgetLow: contextBudgetNotice.contextBudgetNotice(
        {
          occupancySource: "measured",
          occupied: 90_000,
          remaining: 10_000,
          status: "warn",
          usable: 100_000,
        },
        "/Users/mac-user/notes.md",
      ),
      environmentChange: environmentModelText.environmentChangeModelNote({
        ...ENVIRONMENT,
        platform: "linux",
      }),
      folders: buildFoldersText.buildFoldersText({
        folders: [
          { path: "/Users/mac-user" },
          { path: "/Users/mac-user/a/Notes" },
          { missing: true, path: "/Users/mac-user/b/Notes" },
        ],
        intro: "<intro>",
      }),
      ignoredBuilds: ignoredBuildsNote.ignoredBuildsNote(
        "Ignored build scripts: esbuild",
      ),
      macAppGuides: MAC_APPS.map((app) =>
        macAppGuide.macAppGuide(app, app.server),
      ),
      packageScope: nativeSandboxRefusals.packageScopeNote(
        "Cannot read package config /Users/mac-user/package.json: operation not permitted",
      ),
      platformGuidance: ["darwin", "linux", "win32", "freebsd"].map(
        (platform) => environmentModelText.platformGuidance(platform),
      ),
      signInProgress: signInProgress.signInProgressLine([
        { name: "Notion", slug: "notion", standing: "connected" },
        { name: "Linear", slug: "linear", standing: "waiting" },
        { name: "Figma", slug: "figma", standing: "declined" },
        { name: "Slack", slug: "slack", standing: "failed" },
      ]),
      stoppedByAgent: errorText(
        stoppedToolCall.withStoppedToolCallModelText(
          tool(
            { errorText: STOPPED_TOOL_CALL_ERROR_TEXT, state: "output-error" },
            "agent",
          ),
        ),
      ),
      stoppedByUser: errorText(
        stoppedToolCall.withStoppedToolCallModelText(
          tool(
            { errorText: STOPPED_TOOL_CALL_ERROR_TEXT, state: "output-error" },
            "user",
          ),
        ),
      ),
      timeZoneRegion: environmentModelText.timeZoneRegion("Europe/Berlin"),
      unanswered: errorText(
        stoppedToolCall.withUnansweredToolCallResult(
          tool({ state: "input-available" }),
        ),
      ),
      pageReturned: pageTakeover.pageTakeoverModelNote({
        page: { title: "Sign in", url: "https://example.com" },
        stage: "returned",
        tab: "tab_1",
      }),
      pageTaken: pageTakeover.pageTakeoverModelNote({
        page: { title: "", url: "https://example.com" },
        stage: "taken",
        tab: "tab_1",
      }),
      runningRouterModel: modelChange.runningModelText(
        createMockAIGatewayModel({ providerId: "openrouter" }),
      ),
      skillChanges: skillChanges.skillChangesModelNote({
        created: ["pdf"],
        updated: ["slides"],
      }),
      undoneChats: undoneChanges.undoneChatsModelNote({
        changes: [
          {
            after: true,
            before: false,
            chat: ChatIdSchema.parse("2026-11-10-trip-a1b2"),
            field: "archived",
          },
        ],
        undone: { at: "2026-11-10T10:00:00Z", skipped: 0 },
      }),
      undoneProjects: undoneChanges.undoneProjectsModelNote({
        changes: [
          {
            change: "changed",
            fields: [{ after: "Houseplants", before: "Plants", field: "name" }],
            kind: "project",
            name: "Houseplants",
          },
        ],
        undone: { at: "2026-11-10T10:00:00Z", skipped: 1 },
      }),
      workspaceInstructionsEmpty:
        workspaceInstructions.workspaceInstructionsModelNote({
          file: "/Users/mac-user/Instrument/AGENTS.md",
        }),
    }).toMatchSnapshot();
  });
});

describe.skipIf(WINDOWS)("the exported text constants", () => {
  it.each(Object.entries(MODULES))("%s", (_, module) => {
    expect(constantsOf(module)).toMatchSnapshot();
  });
});
