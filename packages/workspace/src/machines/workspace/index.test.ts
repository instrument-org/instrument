import { aiGatewayApp, noopModelCache } from "@instrument-org/ai-gateway";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { noop } from "radashi";
import { describe, expect, it, vi } from "vitest";
import { type AnyActorLogic, createActor, fromCallback } from "xstate";

import { taskDir } from "../../lib/task-dir-utils";
import { getTaskSettings } from "../../lib/task-settings";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { unavailableWebSearchClient } from "../../schemas/web-search";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import {
  createStubBrowserConfig,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-task-config";
import { workspaceMachine } from "./index";

// Long-running no-op actor used to stand in for every spawned child machine.
// It stays "active" until the parent stops it, so we can assert which children
// survive a trash.
const stubActor: AnyActorLogic = fromCallback(noop);

// provide() demands each override match the original child machine's full
// logic type, which a no-op stub can't. Cast the override map so the stub can
// stand in for every child; the test only needs spawnable, stoppable children.
const stubActors = {
  runtimeMachine: stubActor,
  sessionMachine: stubActor,
  taskBrowserMachine: stubActor,
  workspaceServerLogic: stubActor,
} as Parameters<typeof workspaceMachine.provide>[0]["actors"];

const testMachine = workspaceMachine.provide({ actors: stubActors });

function createWorkspaceActor(rootDir = "/tmp/workspace") {
  return createActor(testMachine, {
    input: {
      aiGatewayApp,
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
      registryDir: MOCK_WORKSPACE_DIRS.registry,
      rootDir,
      shimClientDir: "dev-server",
      systemSkillsDir: MOCK_WORKSPACE_DIRS.systemSkills,
      trashItem: () => Promise.resolve(),
      uvBinPath: "/tmp/uv",
      uvDataDir: "/tmp/workspace/uv-data",
      webSearch: unavailableWebSearchClient,
    },
  });
}

describe("workspaceMachine task trashing", () => {
  it("trashing a task does not stop a sibling whose id contains the trashed id", () => {
    const trashedId = TaskIdSchema.parse("2026-06-26-task");
    // Sibling id contains the trashed id as a substring (same prompt twice).
    const siblingId = TaskIdSchema.parse("2026-06-26-task-2");

    const actor = createWorkspaceActor();
    actor.start();

    actor.send({ type: "spawnRuntime", value: { taskId: trashedId } });
    actor.send({ type: "spawnRuntime", value: { taskId: siblingId } });

    const siblingRef = actor.getSnapshot().context.runtimeRefs.get(siblingId);
    expect(siblingRef).toBeDefined();

    actor.send({ type: "prepareToTrashTask", value: { id: trashedId } });

    const { runtimeRefs } = actor.getSnapshot().context;
    expect(runtimeRefs.has(trashedId)).toBe(false);
    expect(runtimeRefs.has(siblingId)).toBe(true);
    expect(siblingRef?.getSnapshot().status).toBe("active");

    actor.stop();
  });

  it("spawning a runtime whose id ends with a trashed id is not blocked", () => {
    const trashedId = TaskIdSchema.parse("task");
    // New id has the trashed id as a suffix; the old endsWith guard wrongly
    // treated it as a child of the task being trashed.
    const newId = TaskIdSchema.parse("my-task");

    const actor = createWorkspaceActor();
    actor.start();

    actor.send({ type: "prepareToTrashTask", value: { id: trashedId } });
    actor.send({ type: "spawnRuntime", value: { taskId: newId } });

    expect(actor.getSnapshot().context.runtimeRefs.has(newId)).toBe(true);

    actor.stop();
  });
});

describe("workspaceMachine unread indicators", () => {
  it("marks a task unread when its root session finishes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsm-indicator-"));
    const taskId = TaskIdSchema.parse("finished-task");

    const actor = createWorkspaceActor(root);
    actor.start();

    // Root session: no parentSessionId. Exercises the mark + write path.
    actor.send({
      type: "session.done",
      value: { actorId: "session-1", taskId, usedNonReadOnlyTools: false },
    });

    // The mark is fire-and-forget, so wait for the settings write to land.
    await vi.waitFor(async () => {
      const settings = await getTaskSettings(taskDir(taskId));
      expect(settings?.unreadIndicator).toEqual({ kind: "completed" });
    });

    actor.stop();
    await fs.rm(root, { force: true, recursive: true });
  });

  it("does not mark a task unread when a subagent session finishes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "wsm-indicator-sub-"));
    const taskId = TaskIdSchema.parse("running-task");

    const actor = createWorkspaceActor(root);
    actor.start();

    // Subagent session: parentSessionId is set, so the parent turn is still
    // running -- the task must not be marked unread yet.
    actor.send({
      type: "session.done",
      value: {
        actorId: "subagent-1",
        parentSessionId: StoreId.newSessionId(),
        taskId,
        usedNonReadOnlyTools: false,
      },
    });

    // Give the fire-and-forget path a chance to (wrongly) write, then assert it
    // did not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const settings = await getTaskSettings(taskDir(taskId));
    expect(settings?.unreadIndicator).toBeUndefined();

    actor.stop();
    await fs.rm(root, { force: true, recursive: true });
  });
});

describe("workspaceMachine session ref lifecycle", () => {
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
    taskId: TaskId,
    parentSessionId?: StoreId.Session,
  ) => {
    actor.send({
      type: "internal.spawnSession",
      value: {
        agentName: "main",
        message: buildUserMessage(),
        model: createMockAIGatewayModel(),
        parentSessionId,
        sessionId: StoreId.newSessionId(),
        taskId,
      },
    });
  };

  it("drops a session ref when that session finishes", () => {
    const taskId = TaskIdSchema.parse("gc-task");

    const actor = createWorkspaceActor();
    actor.start();

    spawnSession(actor, taskId);

    const sessionRef = actor
      .getSnapshot()
      .context.sessionRefsByTaskId.get(taskId)?.[0];
    expect(sessionRef).toBeDefined();

    actor.send({
      type: "session.done",
      value: {
        actorId: sessionRef?.id ?? "",
        taskId,
        usedNonReadOnlyTools: false,
      },
    });

    // The finished session's ref is gone, and with no refs left the task key is
    // removed so it stops counting as active.
    expect(actor.getSnapshot().context.sessionRefsByTaskId.has(taskId)).toBe(
      false,
    );

    actor.stop();
  });

  it("keeps other session refs when one of several finishes", () => {
    const taskId = TaskIdSchema.parse("gc-multi-task");

    const actor = createWorkspaceActor();
    actor.start();

    spawnSession(actor, taskId);
    spawnSession(actor, taskId, StoreId.newSessionId());

    const refs = actor.getSnapshot().context.sessionRefsByTaskId.get(taskId);
    expect(refs).toHaveLength(2);
    const [first, second] = refs ?? [];

    actor.send({
      type: "session.done",
      value: {
        actorId: first?.id ?? "",
        taskId,
        usedNonReadOnlyTools: false,
      },
    });

    const remaining = actor
      .getSnapshot()
      .context.sessionRefsByTaskId.get(taskId);
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0]?.id).toBe(second?.id);

    actor.stop();
  });
});
