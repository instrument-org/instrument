import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = vi.hoisted(() => ({ value: "" }));

vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  workspaceMachineDir: () => dir.value,
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));

import {
  currentWorkspaceScope,
  openWorkspaceScope,
  perWorkspace,
  WorkspaceScope,
} from "./workspace-scope";

describe("WorkspaceScope", () => {
  it("opens a value once, and closes everything newest first", async () => {
    const scope = new WorkspaceScope();
    const closed: string[] = [];
    const first = {};
    const second = {};
    let opened = 0;
    const open = () => {
      opened += 1;
      return opened;
    };

    expect(scope.value(first, open, () => closed.push("first"))).toBe(1);
    expect(scope.value(first, open)).toBe(1);
    scope.onClose(() => closed.push("hook"));
    expect(scope.value(second, open, () => closed.push("second"))).toBe(2);
    expect(scope.peek(second)).toBe(2);

    await scope.close(() => undefined);

    expect(closed).toEqual(["second", "hook", "first"]);
    expect(scope.closed).toBe(true);
    expect(scope.peek(first)).toBeUndefined();
    expect(() => scope.value(first, open)).toThrow("This workspace is closed");
  });

  it("closes the rest when one close throws, and says which", async () => {
    const scope = new WorkspaceScope();
    const closed: string[] = [];
    scope.value(
      {},
      () => "a",
      () => closed.push("a"),
    );
    scope.value(
      {},
      () => "b",
      () => {
        throw new Error("b would not close");
      },
    );
    const errors: unknown[] = [];

    await scope.close((error) => errors.push(error));

    expect(closed).toEqual(["a"]);
    expect(errors).toEqual([new Error("b would not close")]);
  });
});

describe("perWorkspace", () => {
  it("opens its value again in the next scope, letting the old one go", async () => {
    let made = 0;
    const released: number[] = [];
    const get = perWorkspace(
      () => ++made,
      (value) => released.push(value),
    );

    expect(get()).toBe(1);
    expect(get()).toBe(1);
    await currentWorkspaceScope().close(() => undefined);
    openWorkspaceScope();

    expect(released).toEqual([1]);
    expect(get()).toBe(2);
  });
});

describe("a workspace store across a switch", () => {
  let first: string;
  let second: string;

  beforeEach(() => {
    first = fs.mkdtempSync(path.join(os.tmpdir(), "scope-first-"));
    second = fs.mkdtempSync(path.join(os.tmpdir(), "scope-second-"));
  });

  afterEach(() => {
    fs.rmSync(first, { force: true, recursive: true });
    fs.rmSync(second, { force: true, recursive: true });
  });

  it("writes the next workspace's file once the first one's scope closed", async () => {
    const { workspaceModelRoutes } = await import("../stores/workspace/state");
    dir.value = first;
    workspaceModelRoutes.remember("model", "first-provider");

    await currentWorkspaceScope().close(() => undefined);
    openWorkspaceScope();
    dir.value = second;

    expect(workspaceModelRoutes.read()).toEqual({});
    workspaceModelRoutes.remember("model", "second-provider");
    expect(
      JSON.parse(fs.readFileSync(path.join(first, "state.json"), "utf8")),
    ).toMatchObject({ modelRoutes: { model: "first-provider" } });
    expect(
      JSON.parse(fs.readFileSync(path.join(second, "state.json"), "utf8")),
    ).toMatchObject({ modelRoutes: { model: "second-provider" } });
  });
});
