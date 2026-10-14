import path from "node:path";
import { describe, expect, it } from "vitest";

import { isRefusedByName, machineFolderViewRule } from "./refused-files";

const MACHINE = path.join(path.parse(process.cwd()).root, "machine");
const at = (...segments: string[]) => path.join(MACHINE, ...segments);

describe("isRefusedByName", () => {
  const rule = machineFolderViewRule({
    machineDir: MACHINE,
    workspaceDir: path.join(path.parse(process.cwd()).root, "elsewhere"),
  });

  it.each([
    ["the registry of workspaces", at("workspaces.json"), true],
    ["a workspace's keys", at("workspaces-data", "x", "keys", "a.json"), true],
    ["the runtime", at("runtime", "bin", "node"), true],
    [
      "the default workspace's chat",
      at("workspace", "chats", "c", "a.md"),
      false,
    ],
    [
      "a workspace made from the dev panel",
      at("workspaces", "w", "a.md"),
      false,
    ],
    [
      "a workspace's records",
      at("workspace", ".instrument", "workspace.json"),
      true,
    ],
    ["a folder whose name only starts the same", `${MACHINE}-other`, false],
    [
      "the open workspace outside the machine folder",
      path.join(path.parse(process.cwd()).root, "elsewhere", "a.md"),
      false,
    ],
  ])("%s: %s refused %s", (_case, hostPath, refused) => {
    expect(isRefusedByName(hostPath, rule)).toBe(refused);
  });

  it("refuses a folder named both refused and viewable", () => {
    expect(
      isRefusedByName(
        at("a.md"),
        machineFolderViewRule({ machineDir: MACHINE, workspaceDir: MACHINE }),
      ),
    ).toBe(true);
  });
});
