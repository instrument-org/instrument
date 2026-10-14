import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { AbsolutePathSchema } from "../../schemas/paths";
import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { type WorkspaceRPCContext } from "../base";
import { window } from "./window";

let home: string;
let decorated: string[];

beforeEach(() => {
  createMockChatConfig(ChatIdSchema.parse(`window-${Date.now()}`));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "window-route-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  decorated = [];
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    ensureOutputFolderIcon: (folder) => {
      decorated.push(folder);
      return Promise.resolve();
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { force: true, recursive: true });
});

async function ensure() {
  const context: WorkspaceRPCContext = {
    workspaceConfig: getWorkspaceConfig(),
    // The route never reads the actor ref, so the cast spares the test
    // booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
  await call(window.ensure, undefined, { context });
}

it("leaves Instrument in Documents undecorated when it was already there", async () => {
  fs.mkdirSync(path.join(home, "Documents", "Instrument"), {
    recursive: true,
  });
  await ensure();
  expect(decorated).toEqual([]);
});

it("decorates Instrument in Documents once it has made it", async () => {
  await ensure();
  expect(decorated).toEqual([path.join(home, "Documents", "Instrument")]);
});

it("decorates the folder the person picked for their workspace", async () => {
  const picked = path.join(home, "Documents", "Instrument");
  fs.mkdirSync(picked, { recursive: true });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    outputDir: AbsolutePathSchema.parse(picked),
  });
  await ensure();
  expect(decorated).toEqual([picked]);
});
