import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  isRecordPath,
  isRefusedByName,
  isRefusedFile,
  machineFolderViewRule,
} from "./refused-files";

/** Whether this system opens a name in another case as the same file. */
const FOLDS_CASE =
  process.platform === "darwin" || process.platform === "win32";

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
    // Firmlinks join the Data volume to `/` on a Mac, and realpath leaves
    // the longer spelling alone.
    [
      "a workspace's keys by the Data volume's path",
      `/System/Volumes/Data${at("workspaces-data", "x", "keys", "a.json")}`,
      process.platform === "darwin",
    ],
    [
      "the registry of workspaces by the Data volume's path in lower case",
      `/system/volumes/data${at("workspaces.json")}`,
      process.platform === "darwin",
    ],
    [
      "a workspace's keys spelled in upper case",
      at("WORKSPACES-DATA", "X", "KEYS", "a.json"),
      true,
    ],
    [
      "the open workspace's work folder spelled in upper case",
      at("WORKSPACES-DATA", "X", "WORK", "c", "a.md"),
      !FOLDS_CASE,
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

  it.runIf(process.platform === "darwin")(
    "refuses the machine folder named by the Data volume's path",
    () => {
      const onData = machineFolderViewRule({
        machineDir: `/System/Volumes/Data${MACHINE}`,
        workspaceDir: undefined,
      });
      expect(isRefusedByName(at("workspaces.json"), onData)).toBe(true);
    },
  );

  it("refuses a folder named both refused and viewable", () => {
    expect(
      isRefusedByName(
        at("a.md"),
        machineFolderViewRule({ machineDir: MACHINE, workspaceDir: MACHINE }),
      ),
    ).toBe(true);
  });
});

describe("isRefusedFile", () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "refused-files-")),
  );
  const machine = path.join(root, "machine");
  const keys = path.join(machine, "workspaces-data", "x", "keys");
  const elsewhere = path.join(root, "elsewhere");
  fs.mkdirSync(keys, { recursive: true });
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(keys, "k.json"), "{}");
  fs.writeFileSync(path.join(elsewhere, "notes.md"), "");
  fs.symlinkSync(keys, path.join(elsewhere, "escape"));
  const rule = machineFolderViewRule({
    machineDir: machine,
    workspaceDir: elsewhere,
  });

  afterAll(() => {
    fs.rmSync(root, { force: true, recursive: true });
  });

  // A file not made yet through a link into the machine folder is where a
  // write would put it, so it is refused as the files there are.
  it.each([
    ["a file of the person's", path.join(elsewhere, "notes.md"), false],
    ["a new file of the person's", path.join(elsewhere, "new.md"), false],
    [
      "a new file in a new folder of the person's",
      path.join(elsewhere, "new", "new.md"),
      false,
    ],
    ["a key through a link", path.join(elsewhere, "escape", "k.json"), true],
    ["the link itself", path.join(elsewhere, "escape"), true],
    [
      "a new file through a link",
      path.join(elsewhere, "escape", "new.json"),
      true,
    ],
    [
      "a new file in a new folder through a link",
      path.join(elsewhere, "escape", "new", "new.json"),
      true,
    ],
  ])("%s: %s refused %s", async (_case, hostPath, refused) => {
    expect(await isRefusedFile(hostPath, rule)).toBe(refused);
  });

  it.runIf(process.platform === "darwin")(
    "refuses a key by the Data volume's path",
    async () => {
      expect(
        await isRefusedFile(
          `/System/Volumes/Data${path.join(keys, "k.json")}`,
          rule,
        ),
      ).toBe(true);
    },
  );
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
    [
      "a draft in Drafts",
      "/Users/sam/Instrument/Drafts/2026-10-14/DRAFT.md",
      false,
    ],
    [
      "what a build left in the folder drafts were hidden in",
      data("drafts", "d", "draft.md"),
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
    ["a memory in Memory", "/Users/sam/Instrument/Memory/no-stevia.md", false],
    [
      "what a build left in the folder memories were hidden in",
      data("memory", "no-stevia.md"),
      true,
    ],
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

  // Windows drops the dots and spaces that end a name, so each of these
  // opens the workspace's `.instrument`; elsewhere each is a name of its own.
  it.each([
    "C:\\Users\\sam\\Instrument\\.instrument.\\chats\\c\\chat.db",
    "C:\\Users\\sam\\Instrument\\.instrument \\chats\\c\\chat.db",
    "C:\\Users\\sam\\Instrument\\.INSTRUMENT. .\\workspace.json",
    "C:/Users/sam/Instrument/.instrument../preferences.json",
  ])("reads %s as a record on Windows only", (hostPath) => {
    expect(isRecordPath(hostPath, "win32")).toBe(true);
    expect(isRecordPath(hostPath, "darwin")).toBe(false);
  });
});
