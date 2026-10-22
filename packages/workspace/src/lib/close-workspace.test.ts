import { aiGatewayApp, noopModelCache } from "@instrument-org/ai-gateway";
import { noop } from "radashi";
import { afterEach, describe, expect, it } from "vitest";
import { type AnyActorLogic, createActor, fromCallback } from "xstate";

import { workspaceMachine } from "../machines/workspace";
import { publisher } from "../rpc/publisher";
import { unavailableWebSearchClient } from "../schemas/web-search";
import {
  createStubBrowserConfig,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-chat-config";
import { createMemoryAppsConfig } from "./apps/memory-config";
import { attachChats } from "./chat/attach";
import { closeWorkspace } from "./close-workspace";
import { newDeviceId } from "./records/device-id";
import {
  ChatRecords,
  installChatRecords,
  writingChatRecords,
} from "./records/chat-records";
import { chatDir } from "./record-folders";
import { getWorkspaceConfig } from "./workspace-config";

const stub: AnyActorLogic = fromCallback(noop);
const machine = workspaceMachine.provide({
  actors: {
    sessionMachine: stub,
    windowBrowserLogic: stub,
    workspaceServerLogic: stub,
  } as Parameters<typeof workspaceMachine.provide>[0]["actors"],
});

function startWorkspace(rootDir: string) {
  const actor = createActor(machine, {
    input: {
      aiGatewayApp,
      apps: createMemoryAppsConfig(),
      appVersion: "0.0.0-test",
      browser: createStubBrowserConfig(),
      captureException: noop,
      deviceId: newDeviceId(),
      getAIProviderConfigs: () => [],
      modelCache: noopModelCache,
      nodeExecEnv: {},
      pnpmBinPath: "/tmp/pnpm",
      registryDir: MOCK_WORKSPACE_DIRS.registry,
      rootDir,
      runtimeDir: "/tmp/workspace/runtime",
      systemSkillsDir: MOCK_WORKSPACE_DIRS.systemSkills,
      trashItem: () => Promise.resolve(),
      userDataDir: MOCK_WORKSPACE_DIRS.machine,
      uvBinPath: "/tmp/uv",
      webSearch: unavailableWebSearchClient,
      workFoldersDir: MOCK_WORKSPACE_DIRS.work,
      workspaceMachineDir: MOCK_WORKSPACE_DIRS.machine,
    },
  });
  actor.start();
  return actor;
}

/** Lets the subscription loops reach their first wait, or their end. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => {
  // The suite's own records, which the workspace machine put aside.
  installChatRecords(
    new ChatRecords({
      app: "0.0.0-test",
      device: newDeviceId(),
      dirOf: chatDir,
      fsync: false,
    }),
  );
});

describe("attachChats", () => {
  it("answers a detach that ends every subscription it made", async () => {
    const before = publisher.size;
    const actor = startWorkspace("/tmp/close-workspace-a");
    const detach = attachChats(actor);
    await settle();
    expect(publisher.size).toBeGreaterThan(before);

    await detach();

    expect(publisher.size).toBe(before);
    actor.stop();
  });
});

describe("closeWorkspace", () => {
  it("stops the actor and lets the next one's config be the one read", async () => {
    const first = startWorkspace("/tmp/close-workspace-a");
    const detach = attachChats(first);
    await settle();

    const errors: unknown[] = [];
    await closeWorkspace({
      detach,
      onError: (error) => errors.push(error),
      workspaceRef: first,
    });

    expect(first.getSnapshot().status).toBe("stopped");
    expect(writingChatRecords()).toBeUndefined();

    const second = startWorkspace("/tmp/close-workspace-b");
    expect(getWorkspaceConfig().rootDir).toBe("/tmp/close-workspace-b");
    expect(writingChatRecords()).toBeDefined();
    expect(errors).toEqual([]);
    second.stop();
  });
});
