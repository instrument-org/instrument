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

const options = { context: {} as InitialRPCContext };

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(tmpdir(), "drafts-route-"));
});
afterEach(async () => {
  await fs.rm(workspace, { force: true, recursive: true });
});

const PNG = Buffer.from("not really a png").toString("base64");

it("writes two pastes of the same name into the draft's folder, the second numbered", async () => {
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

  expect(path.relative(workspace, first.path)).toBe("drafts/d1/image.png");
  expect(path.relative(workspace, second.path)).toBe("drafts/d1/image 2.png");
  expect(first.size).toBe(16);
  expect(await fs.readFile(second.path, "utf8")).toBe("not really a png");
});

it("rewrites an item handed over again rather than adding a copy", async () => {
  const stage = () =>
    call(
      drafts.stage,
      { content: PNG, draftId: "d2", itemId: "a", name: "notes.txt" },
      options,
    );
  const first = await stage();
  const again = await stage();

  expect(again.path).toBe(first.path);
  expect(await fs.readdir(path.join(workspace, "drafts/d2"))).toEqual([
    "notes.txt",
  ]);
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
