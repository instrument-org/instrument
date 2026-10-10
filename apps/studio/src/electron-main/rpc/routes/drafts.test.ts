import { call, os } from "@orpc/server";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { type InitialRPCContext } from "../context";
import { drafts } from "./drafts";

let workspace: string;

vi.mock("@/electron-main/rpc/base", () => ({ base: os }));
vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  getWorkspaceFolder: () => workspace,
}));
vi.mock("@/electron-main/lib/workspaces", () => ({
  workspacePrivateDir: (folder: string) => path.join(folder, ".instrument"),
}));

const options = { context: {} as InitialRPCContext };

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(tmpdir(), "drafts-route-"));
});
afterEach(async () => {
  await fs.rm(workspace, { force: true, recursive: true });
});

const PNG = Buffer.from("not really a png").toString("base64");

it("writes two pastes of the same name to files of their own, under that name", async () => {
  const first = await call(
    drafts.stage,
    { content: PNG, draftId: "d1", itemId: "a", name: "image.png" },
    options,
  );
  const second = await call(
    drafts.stage,
    { content: PNG, draftId: "d1", itemId: "b", name: "image.png" },
    options,
  );

  expect(path.basename(first.path)).toBe("image.png");
  expect(first.path).not.toBe(second.path);
  expect(first.size).toBe(16);
  expect(await fs.readFile(second.path, "utf8")).toBe("not really a png");
});

it.each(["../escape.png", "a/b.png", "..", ""])(
  "refuses %j as a name",
  async (name) => {
    await expect(
      call(
        drafts.stage,
        { content: PNG, draftId: "d1", itemId: "a", name },
        options,
      ),
    ).rejects.toThrow();
  },
);

it("clears one draft's files and prunes those of drafts no longer kept", async () => {
  const stage = (draftId: string) =>
    call(
      drafts.stage,
      { content: PNG, draftId, itemId: "a", name: "image.png" },
      options,
    );
  const gone = await stage("gone");
  const kept = await stage("kept");
  const orphan = await stage("orphan");

  await call(drafts.clear, { draftId: "gone" }, options);
  await call(drafts.prune, { keep: ["kept"] }, options);

  await expect(fs.stat(gone.path)).rejects.toThrow();
  await expect(fs.stat(orphan.path)).rejects.toThrow();
  expect((await fs.stat(kept.path)).isFile()).toBe(true);
});

it("prunes nothing when no draft ever kept a file", async () => {
  await expect(
    call(drafts.prune, { keep: [] }, options),
  ).resolves.toBeUndefined();
});
