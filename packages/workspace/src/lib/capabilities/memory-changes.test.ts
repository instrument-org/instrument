import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { memoryDir, readMemory, saveMemory } from "../memory/store";
import { undoMemoryChanges } from "../memory/undo-memory-changes";
import { createLocalBashEnv } from "../create-bash-env";
import {
  beginSetupChangeTracking,
  consumeSetupChanges,
} from "../setup-changes";
import { withTurnContext } from "../turn-context";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";

// No session has a live agent here.
vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      getSnapshot: () => ({
        context: { sessionRefsByChatId: { get: () => [] } },
      }),
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

let counter = 0;
const roots: string[] = [];
let own: { chatId: ChatId; sessionId: StoreId.Session };

beforeEach(async () => {
  createMockChatConfig(
    ChatIdSchema.parse(`memory-changes-${Date.now()}-${(counter += 1)}`),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-changes-"));
  roots.push(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  const sessionId = StoreId.newSessionId();
  own = {
    chatId: await chatFor(sessionId, ChatIdSchema.parse("organizer")),
    sessionId,
  };
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

/** Runs commands in the chat's shell as one turn, and answers what the turn changed. */
async function turn(...commands: string[]) {
  const key = { id: own.chatId, sessionId: own.sessionId };
  beginSetupChangeTracking(key);
  const bash = await createLocalBashEnv({ ...own, role: "chat" });
  for (const command of commands) {
    const result = await withTurnContext(key, () => bash.exec(command));
    expect(result.stderr).toBe("");
  }
  return consumeSetupChanges(key);
}

const said = async (name: string) =>
  (await readMemory(memoryDir(), name))?.text;

describe("a turn's memory changes", () => {
  it("records each memory's text before and after, the first before kept", async () => {
    await saveMemory(memoryDir(), { name: "team-size", text: "8 agents." });
    await saveMemory(memoryDir(), { name: "discount", text: "10% at most." });
    const changes = await turn(
      "instrument memory save annual-prices 'Quote annual prices.'",
      "instrument memory save team-size '9 agents.'",
      "instrument memory save team-size '10 agents.'",
      "instrument memory forget discount",
    );
    expect(changes).toEqual([
      {
        change: "added",
        kind: "memory",
        memory: { after: "Quote annual prices.", before: null },
        name: "annual-prices",
      },
      {
        change: "removed",
        kind: "memory",
        memory: { after: null, before: "10% at most." },
        name: "discount",
      },
      {
        change: "changed",
        kind: "memory",
        memory: { after: "10 agents.", before: "8 agents." },
        name: "team-size",
      },
    ]);
  });

  it("undoes each, leaving a memory the person changed since", async () => {
    await saveMemory(memoryDir(), { name: "team-size", text: "8 agents." });
    await saveMemory(memoryDir(), { name: "discount", text: "10% at most." });
    const changes = await turn(
      "instrument memory save annual-prices 'Quote annual prices.'",
      "instrument memory save team-size '10 agents.'",
      "instrument memory forget discount",
    );
    // The person corrects a memory the turn saved before undoing.
    await saveMemory(memoryDir(), { name: "team-size", text: "12 agents." });
    expect(
      await undoMemoryChanges(
        changes.flatMap((change) =>
          change.memory ? [{ memory: change.memory, name: change.name }] : [],
        ),
      ),
    ).toEqual({ skipped: 1, undone: 2 });
    expect(await said("annual-prices")).toBeUndefined();
    expect(await said("discount")).toBe("10% at most.");
    expect(await said("team-size")).toBe("12 agents.");
  });
});
