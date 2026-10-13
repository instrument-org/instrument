import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";

import { readPermissionSettings } from "../../lib/permissions/rules";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type WorkspaceRPCContext } from "../base";
import { permissions } from "./permissions";

function createContext(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // These routes never read the actor ref, so the cast spares the test
    // booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

beforeEach(() => {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(
      fs.mkdtempSync(path.join(os.tmpdir(), "permissions-route-")),
    ),
  });
});

it("sets a place, not a folder, for a folder that is a place on its own", async () => {
  await call(
    permissions.setFolder,
    {
      level: "allow",
      path: AbsolutePathSchema.parse(path.join(os.homedir(), "Documents")),
    },
    { context: createContext() },
  );
  const settings = await readPermissionSettings();
  expect(settings.places.documents).toBe("allow");
  expect(settings.folders).toEqual([]);
});

it("keeps a folder rule for a folder inside a place", async () => {
  const folder = AbsolutePathSchema.parse(
    path.join(os.homedir(), "Documents", "Taxes"),
  );
  await call(
    permissions.setFolder,
    { level: "allow", path: folder },
    { context: createContext() },
  );
  const settings = await readPermissionSettings();
  expect(settings.places.documents).toBeUndefined();
  expect(settings.folders.map((f) => f.path)).toEqual([folder]);
});
