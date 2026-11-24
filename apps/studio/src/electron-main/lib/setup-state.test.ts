import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { answerSetupIn } from "./setup-state";

vi.mock("@/electron-main/lib/workspace-run", () => ({
  getLocalWorkspace: () => ({ machineDir: "/elsewhere" }),
  getWorkspaceRun: () => ({ kind: "unplaced" }),
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { error: vi.fn() },
}));
vi.mock("@/electron-main/lib/workspaces", () => ({
  writeJsonAtomic: (file: string, value: unknown) => {
    fs.writeFileSync(file, JSON.stringify(value));
  },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("@/electron-main/stores/machine/state", () => ({
  getMachineState: vi.fn(),
}));
vi.mock("@/electron-main/stores/workspace/state", () => ({
  readSetupRecord: () => ({ answered: {} }),
  writeSetupRecord: vi.fn(),
}));

const KEPT = { modelRoutes: { a: "b" }, searchPicks: [{ typed: "x" }] };
let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-state-"));
  file = path.join(dir, WORKSPACE_MACHINE_ENTRIES.state);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true });
});

const read = (): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

it("answers in a workspace's state, the rest of it kept", () => {
  fs.writeFileSync(file, JSON.stringify(KEPT));
  answerSetupIn(dir);
  expect(read()).toMatchObject({ ...KEPT, setup: {} });
});

it.each([
  ["that has none yet", undefined],
  ["whose state is cut short", "{"],
])("answers in a workspace %s", (_case, contents) => {
  if (contents !== undefined) {
    fs.writeFileSync(file, contents);
  }
  answerSetupIn(dir);
  expect(read()).toMatchObject({ setup: {} });
});

it("leaves a state it could not read as it was", () => {
  fs.writeFileSync(file, JSON.stringify(KEPT));
  vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
    throw Object.assign(new Error("busy"), { code: "EBUSY" });
  });
  answerSetupIn(dir);
  expect(read()).toEqual(KEPT);
});
