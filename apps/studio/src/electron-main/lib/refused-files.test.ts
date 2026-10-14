import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isRecordPath,
  isRefusedByName,
  machineFolderViewRule,
} from "./refused-files";

const MACHINE = path.join(path.parse(process.cwd()).root, "machine");
const at = (...segments: string[]) => path.join(MACHINE, ...segments);

describe("isRefusedByName", () => {
  const rule = machineFolderViewRule({
    machineDir: MACHINE,
    workspaceDir: path.join(path.parse(process.cwd()).root, "elsewhere"),
    workspaceMachineDir: at("workspaces-data", "x"),
  });

  it.each([
    ["the registry of workspaces", at("workspaces.json"), true],
    ["a workspace's keys", at("workspaces-data", "x", "keys", "a.json"), true],
    ["the runtime", at("runtime", "bin", "node"), true],
    [
      "the open workspace's chat's work folder",
      at("workspaces-data", "x", "work", "c", "a.md"),
      false,
    ],
    [
      "another workspace's work folder",
      at("workspaces-data", "y", "work", "c", "a.md"),
      true,
    ],
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
    [
      "what a chat in the default workspace was sent",
      at("workspace", ".instrument", "chats", "c", "attachments", "a.png"),
      false,
    ],
    [
      "a chat's database in the default workspace",
      at("workspace", ".instrument", "chats", "c", "chat.db"),
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

  it("refuses a refused folder reached by a step up from a viewable one", () => {
    const up = [
      at("workspace"),
      "..",
      "workspaces-data",
      "x",
      "keys",
      "new.json",
    ].join(path.sep);
    expect(isRefusedByName(up, rule)).toBe(true);
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

describe("isRecordPath", () => {
  const data = (...names: string[]) =>
    ["", "Users", "sam", "Instrument", ".instrument", ...names].join("/");

  it.each([
    ["the person's own file", "/Users/sam/Instrument/Reports/q3.pdf", false],
    ["the workspace's identity", data("workspace.json"), true],
    ["the person's preferences", data("preferences.json"), true],
    ["the usage record", data("ai-usage.db"), true],
    ["the window's tabs", data("window", "chat.db"), true],
    ["a chat's database", data("chats", "c", "chat.db"), true],
    ["a chat's settings", data("chats", "c", "settings.json"), true],
    ["a chat's handoff notes", data("chats", "c", "handoff-notes.md"), true],
    ["the chats folder itself", data("chats"), true],
    ["what a chat was sent", data("chats", "c", "attachments", "a.png"), false],
    ["a chat's attachments folder", data("chats", "c", "attachments"), false],
    [
      "a record named from inside the attachments",
      data("chats", "c", "attachments", "..", "chat.db"),
      true,
    ],
    ["a draft's words", data("drafts", "d", "draft.md"), false],
    ["what was pasted into a draft", data("drafts", "d", "image.png"), false],
    [
      "a draft's own record",
      data("drafts", "d", ".instrument", "settings.json"),
      true,
    ],
    [
      "a topic's instructions",
      data("topics", "Home", "instructions.md"),
      false,
    ],
    [
      "a topic's settings",
      data("topics", "Home", ".instrument", "settings.json"),
      true,
    ],
    ["a workspace skill", data("skills", "brief", "SKILL.md"), false],
    ["an app's setup", data("apps", "linear", "app.json"), false],
    ["a memory", data("memory", "no-stevia.md"), false],
    ["what a migration set aside", data(".pre-chats", "x", "task.db"), true],
    ["a 1.x task's records", "/Users/sam/tasks/t/.instrument/task.db", true],
    [
      "the folder's name in another case",
      "/Users/sam/Instrument/.INSTRUMENT/workspace.json",
      true,
    ],
    [
      "a person's folder in another case",
      data("Chats", "c", "attachments", "a.png"),
      true,
    ],
    [
      "a path spelled with backslashes",
      "C:\\Users\\sam\\Instrument\\.instrument\\chats\\c\\chat.db",
      true,
    ],
    [
      "an attachment spelled with backslashes",
      "C:\\Users\\sam\\Instrument\\.instrument\\chats\\c\\attachments\\a.png",
      false,
    ],
  ])("%s: %s is a record %s", (_case, hostPath, record) => {
    expect(isRecordPath(hostPath)).toBe(record);
  });
});
