import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isDataless } from "./dataless";
import { reachWorkspaceRecord } from "./reach-workspace-record";

vi.mock("./dataless", () => ({ isDataless: vi.fn(() => false) }));

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "reach-")));
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
  vi.mocked(isDataless).mockReset().mockReturnValue(false);
  vi.restoreAllMocks();
});

function withRecord(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(workspaceLayout(dir).dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceLayout(dir).dataDir, "workspace.json"),
    "{}",
  );
  return dir;
}

describe("reachWorkspaceRecord", () => {
  it("is ready once the record reads, or when there is none to write over", async () => {
    expect(await reachWorkspaceRecord(withRecord("Instrument"))).toEqual({
      kind: "ready",
    });
    const empty = path.join(root, "Empty");
    fs.mkdirSync(empty);
    expect(await reachWorkspaceRecord(empty)).toEqual({ kind: "ready" });
  });

  it("says a folder that is gone is missing", async () => {
    expect(await reachWorkspaceRecord(path.join(root, "Gone"))).toEqual({
      kind: "lost",
      reason: "missing",
    });
  });

  it("stops waiting on a download that doesn't come, and a second ask joins the read", async () => {
    const dir = withRecord("Instrument");
    vi.mocked(isDataless).mockReturnValue(true);
    let finish: () => void = () => undefined;
    const readFile = vi.spyOn(fs.promises, "readFile").mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = () => {
            resolve("{}");
          };
        }),
    );
    expect(await reachWorkspaceRecord(dir, { timeoutMs: 10 })).toEqual({
      kind: "lost",
      reason: "cloud",
    });
    const again = reachWorkspaceRecord(dir, { timeoutMs: 1000 });
    finish();
    expect(await again).toEqual({ kind: "ready" });
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
