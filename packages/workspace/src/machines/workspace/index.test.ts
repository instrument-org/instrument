import { aiGatewayApp } from "@instrument-org/ai-gateway";
import { noop } from "radashi";
import { describe, expect, it } from "vitest";
import { type AnyActorLogic, createActor, fromCallback } from "xstate";

import { TaskIdSchema } from "../../schemas/task-id";
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

function createWorkspaceActor() {
  return createActor(testMachine, {
    input: {
      aiGatewayApp,
      appVersion: "0.0.0-test",
      browser: createStubBrowserConfig(),
      captureEvent: noop,
      captureException: noop,
      defaultTaskTemplateDir: MOCK_WORKSPACE_DIRS.defaultTaskTemplate,
      getAIProviderConfigs: () => [],
      nodeExecEnv: {},
      pnpmBinPath: "/tmp/pnpm",
      registryDir: MOCK_WORKSPACE_DIRS.registry,
      rootDir: "/tmp/workspace",
      shimClientDir: "dev-server",
      trashItem: () => Promise.resolve(),
      uvBinPath: "/tmp/uv",
      uvDataDir: "/tmp/workspace/uv-data",
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
