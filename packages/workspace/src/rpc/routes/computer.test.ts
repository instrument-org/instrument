import { call, ORPCError } from "@orpc/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { type WorkspaceRPCContext } from "../base";
import { computer } from "./computer";

const taskId = createMockTaskConfig(TaskIdSchema.parse("computer-route"));

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "computer-route-"));
  await fs.writeFile(path.join(tmpDir, "notes.md"), "# Notes\n");
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

function createContext(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // The listing never reads the actor ref, so the cast spares the test
    // booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

describe("workspace.computer.list", () => {
  it.each([
    ["a file", "notes.md"],
    ["a path through a file", path.join("notes.md", "inside")],
  ])("answers NOT_A_FOLDER for %s", async (_, relative) => {
    const target = path.join(tmpDir, relative);
    const listing = call(
      computer.list,
      { id: taskId, path: target },
      { context: createContext() },
    );

    await expect(listing).rejects.toBeInstanceOf(ORPCError);
    await expect(listing).rejects.toMatchObject({
      code: "NOT_A_FOLDER",
      data: { path: target },
      defined: true,
    });
  });

  it("answers NOT_FOUND for a path with nothing at it", async () => {
    const target = path.join(tmpDir, "missing");
    await expect(
      call(
        computer.list,
        { id: taskId, path: target },
        { context: createContext() },
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { path: target },
      defined: true,
    });
  });

  it("lists a folder", async () => {
    const listing = await call(
      computer.list,
      { id: taskId, path: tmpDir },
      { context: createContext() },
    );

    expect(
      listing.kind === "listing" && listing.entries.map((entry) => entry.name),
    ).toEqual(["notes.md"]);
  });

  it("lists a package as a file by the Finder's name, and hides what it hides", async () => {
    const folder = path.join(tmpDir, "finder");
    await fs.mkdir(path.join(folder, "Calculator.app", "Contents"), {
      recursive: true,
    });
    await fs.mkdir(path.join(folder, "Library"));
    await fs.writeFile(path.join(folder, "report.pdf"), "");
    const config = getWorkspaceConfig();
    setWorkspaceConfig({
      ...config,
      finderEntries: async (asked) =>
        asked === folder
          ? [
              {
                hidesExtension: true,
                kind: "Application",
                name: "Calculator.app",
                package: true,
              },
              { hidden: true, name: "Library" },
            ]
          : [],
    });
    try {
      const listing = await call(
        computer.list,
        { id: taskId, path: folder },
        { context: createContext() },
      );
      expect(
        listing.kind === "listing" &&
          listing.entries.map(
            ({
              createdAt: _created,
              modifiedAt: _modified,
              path: _,
              ...entry
            }) => entry,
          ),
      ).toMatchInlineSnapshot(`
        [
          {
            "hidden": true,
            "kind": "folder",
            "name": "Library",
          },
          {
            "displayName": "Calculator",
            "kind": "file",
            "name": "Calculator.app",
            "package": true,
            "typeName": "Application",
          },
          {
            "kind": "file",
            "mimeType": "application/pdf",
            "name": "report.pdf",
            "size": 0,
          },
        ]
      `);
    } finally {
      setWorkspaceConfig(config);
    }
  });

  it("answers a folder it may not read as refused rather than failing", async () => {
    const target = path.join(tmpDir, "shut");
    await fs.mkdir(target, { mode: 0o000 });
    try {
      await expect(
        call(
          computer.list,
          { id: taskId, path: target },
          { context: createContext() },
        ),
      ).resolves.toMatchObject({ kind: "refused", reason: "account" });
    } finally {
      await fs.chmod(target, 0o700);
    }
  });
});
