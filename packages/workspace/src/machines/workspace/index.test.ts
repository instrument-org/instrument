import { aiGatewayApp, noopModelCache } from "@instrument-org/ai-gateway";
import { noop } from "radashi";
import { describe, expect, it } from "vitest";
import { type AnyActorLogic, createActor, fromCallback } from "xstate";

import { createMemoryAppsConfig } from "../../lib/apps/memory-config";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { unavailableWebSearchClient } from "../../schemas/web-search";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import {
  createStubBrowserConfig,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-chat-config";
import { workspaceMachine } from "./index";

// Long-running no-op actor used to stand in for every spawned child machine.
// It stays "active" until the parent stops it, so we can assert which children
// survive a trash.
const stubActor: AnyActorLogic = fromCallback(noop);

// provide() demands each override match the original child machine's full
// logic type, which a no-op stub can't. Cast the override map so the stub can
// stand in for every child; the test only needs spawnable, stoppable children.
const stubActors = {
  sessionMachine: stubActor,
  taskBrowserMachine: stubActor,
  workspaceServerLogic: stubActor,
} as Parameters<typeof workspaceMachine.provide>[0]["actors"];

const testMachine = workspaceMachine.provide({ actors: stubActors });

function createWorkspaceActor(rootDir = "/tmp/workspace") {
  return createActor(testMachine, {
    input: {
      aiGatewayApp,
      apps: createMemoryAppsConfig(),
      appVersion: "0.0.0-test",
      browser: createStubBrowserConfig(),
      captureEvent: noop,
      captureException: noop,
      defaultTaskTemplateDir: MOCK_WORKSPACE_DIRS.defaultTaskTemplate,
      getAIProviderConfigs: () => [],
      isExternalBrowserEnabled: () => false,
      modelCache: noopModelCache,
      nodeExecEnv: {},
      pnpmBinPath: "/tmp/pnpm",
      preparedSkillsDir: "/tmp/prepared-skills",
      registryDir: MOCK_WORKSPACE_DIRS.registry,
      rootDir,
      systemSkillsDir: MOCK_WORKSPACE_DIRS.systemSkills,
      trashItem: () => Promise.resolve(),
      uvBinPath: "/tmp/uv",
      uvDataDir: "/tmp/workspace/uv-data",
      webSearch: unavailableWebSearchClient,
    },
  });
}

const buildUserMessage = (): SessionMessage.UserWithParts => {
  const sessionId = StoreId.newSessionId();
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: { createdAt: new Date(0), sessionId },
    parts: [
      {
        metadata: {
          createdAt: new Date(0),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        text: "hi",
        type: "text",
      },
    ],
    role: "user",
  };
};

const spawnSession = (
  actor: ReturnType<typeof createWorkspaceActor>,
  chatId: ChatId,
) => {
  actor.send({
    type: "internal.spawnSession",
    value: {
      message: buildUserMessage(),
      model: createMockAIGatewayModel(),
      sessionId: StoreId.newSessionId(),
      chatId,
    },
  });
};

describe("workspaceMachine task trashing", () => {
  it("trashing a task does not stop a sibling whose id contains the trashed id", () => {
    const trashedId = ChatIdSchema.parse("2026-06-26-task");
    // Sibling id contains the trashed id as a substring (same prompt twice).
    const siblingId = ChatIdSchema.parse("2026-06-26-task-2");

    const actor = createWorkspaceActor();
    actor.start();

    spawnSession(actor, trashedId);
    spawnSession(actor, siblingId);

    const siblingRef = actor
      .getSnapshot()
      .context.sessionRefsByChatId.get(siblingId)?.[0];
    expect(siblingRef).toBeDefined();

    actor.send({ type: "prepareToTrashChat", value: { id: trashedId } });

    const { sessionRefsByChatId, chatsBeingTrashed } =
      actor.getSnapshot().context;
    expect(chatsBeingTrashed).toEqual([trashedId]);
    expect(sessionRefsByChatId.has(siblingId)).toBe(true);
    expect(siblingRef?.getSnapshot().status).toBe("active");

    actor.stop();
  });

  it("spawning a session whose task id ends with a trashed id is not blocked", () => {
    const trashedId = ChatIdSchema.parse("task");
    // New id has the trashed id as a suffix; an endsWith guard would wrongly
    // treat it as a child of the task being trashed.
    const newId = ChatIdSchema.parse("my-task");

    const actor = createWorkspaceActor();
    actor.start();

    actor.send({ type: "prepareToTrashChat", value: { id: trashedId } });
    spawnSession(actor, newId);

    expect(actor.getSnapshot().context.sessionRefsByChatId.has(newId)).toBe(
      true,
    );

    actor.stop();
  });
});

describe("workspaceMachine session ref lifecycle", () => {
  it("drops a session ref when that session finishes", () => {
    const chatId = ChatIdSchema.parse("gc-task");

    const actor = createWorkspaceActor();
    actor.start();

    spawnSession(actor, chatId);

    const sessionRef = actor
      .getSnapshot()
      .context.sessionRefsByChatId.get(chatId)?.[0];
    expect(sessionRef).toBeDefined();

    actor.send({
      type: "session.done",
      value: {
        actorId: sessionRef?.id ?? "",
        chatId,
        usedNonReadOnlyTools: false,
      },
    });

    // The finished session's ref is gone, and with no refs left the task key is
    // removed so it stops counting as active.
    expect(actor.getSnapshot().context.sessionRefsByChatId.has(chatId)).toBe(
      false,
    );

    actor.stop();
  });

  it("keeps other session refs when one of several finishes", () => {
    const chatId = ChatIdSchema.parse("gc-multi-task");

    const actor = createWorkspaceActor();
    actor.start();

    spawnSession(actor, chatId);
    spawnSession(actor, chatId);

    const refs = actor.getSnapshot().context.sessionRefsByChatId.get(chatId);
    expect(refs).toHaveLength(2);
    const [first, second] = refs ?? [];

    actor.send({
      type: "session.done",
      value: {
        actorId: first?.id ?? "",
        chatId,
        usedNonReadOnlyTools: false,
      },
    });

    const remaining = actor
      .getSnapshot()
      .context.sessionRefsByChatId.get(chatId);
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0]?.id).toBe(second?.id);

    actor.stop();
  });
});
