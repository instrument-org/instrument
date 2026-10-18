import { execFileSync } from "node:child_process";
import {
  closeSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ChatDirSchema, WorkDirSchema } from "../../schemas/paths";
import { getWorkspaceConfig } from "../workspace-config";
import { buildWorkspaceFsLayout, shellPath } from "../workspace-fs-layout";
import { workspaceLayout } from "../workspace-layout";
import {
  openOperandForStdin,
  shellSpellingOf,
} from "./unsandboxed-uutils-operand";

const base = realpathSync(
  mkdtempSync(path.join(os.tmpdir(), "uutils-operand-")),
);
const chat = path.join(base, "chat");
const outside = path.join(base, "outside");
// The workspace's own data, closed but for every chat's records, which it
// reads.
const appData = path.join(
  workspaceLayout(getWorkspaceConfig().rootDir).dataDir,
  `${path.basename(base)}.txt`,
);
// The chat's record folder, in that data.
const record = path.join(
  workspaceLayout(getWorkspaceConfig().rootDir).dataDir,
  "chats",
  path.basename(base),
);
for (const dir of [
  chat,
  outside,
  record,
  path.join(chat, "closed"),
  path.join(chat, "asks"),
]) {
  mkdirSync(dir, { recursive: true });
}
writeFileSync(path.join(chat, "a.txt"), "one\ntwo\n");
writeFileSync(path.join(chat, "two-names.txt"), "x\n");
linkSync(path.join(chat, "two-names.txt"), path.join(chat, "second-name.txt"));
writeFileSync(path.join(outside, "secret.txt"), "secret\n");
writeFileSync(path.join(record, "s.txt"), "s\n");
writeFileSync(appData, "d\n");
writeFileSync(path.join(chat, "closed", "c.txt"), "c\n");
writeFileSync(path.join(chat, "asks", "q.txt"), "q\n");
// Windows makes a symbolic link only in Developer Mode or for an
// administrator. A junction needs neither and leads out of the chat as well,
// though only to a folder.
let symlinks = true;
try {
  symlinkSync(path.join(outside, "secret.txt"), path.join(chat, "out-link"));
  symlinkSync(path.join(chat, "a.txt"), path.join(chat, "in-link"));
} catch (error) {
  if (process.platform !== "win32") {
    throw error;
  }
  symlinks = false;
  symlinkSync(outside, path.join(chat, "out-junction"), "junction");
}
if (process.platform !== "win32") {
  execFileSync("mkfifo", [path.join(chat, "fifo")]);
}
afterAll(() => {
  rmSync(base, { force: true, recursive: true });
  rmSync(record, { force: true, recursive: true });
  rmSync(appData, { force: true });
});

const layout = buildWorkspaceFsLayout({
  chatHostRoot: WorkDirSchema.parse(chat),
  recordHostRoot: ChatDirSchema.parse(record),
  rules: {
    home: os.homedir(),
    rules: [
      { level: "never", path: path.join(chat, "closed"), source: "folder" },
      { level: "ask", path: path.join(chat, "asks"), source: "folder" },
    ],
    dangerouslyAllowEveryFolder: false,
  },
});

function open(operand: string) {
  const fd = openOperandForStdin({
    layout,
    operand,
    resolvePath: (spelled) => path.posix.resolve(shellPath(chat), spelled),
  });
  if (fd === undefined) {
    return undefined;
  }
  try {
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

describe("openOperandForStdin", () => {
  it.each([
    ["a.txt", "one\ntwo\n"],
    ["./a.txt", "one\ntwo\n"],
    [path.join(chat, "a.txt"), "one\ntwo\n"],
    // Every chat's records are open to reading.
    [path.join(record, "s.txt"), "s\n"],
    // A link that stays inside the chat's folder reads what it leads to.
    ...(symlinks ? [["in-link", "one\ntwo\n"]] : []),
  ])("opens %s", (operand, contents) => {
    expect(open(operand)).toBe(contents);
  });

  it.each([
    [
      "a link out of every folder the chat reaches",
      symlinks ? "out-link" : "out-junction/secret.txt",
    ],
    ["a file outside them", path.join(outside, "secret.txt")],
    ["a file with a second name", "second-name.txt"],
    ["a FIFO", "fifo"],
    ["the app's own data", appData],
    ["a folder the rules close", "closed/c.txt"],
    ["a folder that asks first", "asks/q.txt"],
    ["a folder", "."],
    ["a missing file", "nope.txt"],
    ["the app's environment", "/proc/self/environ"],
    ["a device", "/dev/zero"],
  ])("leaves %s to the sandbox", (_, operand) => {
    expect(open(operand)).toBeUndefined();
  });
});

describe("shellSpellingOf on Windows", () => {
  it.each([
    ["C:\\Users\\sam\\a.txt", "/c/Users/sam/a.txt"],
    ["d:/work/a.txt", "/d/work/a.txt"],
    ["notes\\a.txt", "notes/a.txt"],
    ["/c/Users/sam/a.txt", "/c/Users/sam/a.txt"],
    ["\\\\?\\C:\\Users\\sam\\a.txt", undefined],
    ["\\\\.\\PhysicalDrive0", undefined],
    ["\\\\server\\share\\a.txt", undefined],
    ["//server/share/a.txt", undefined],
    ["C:a.txt", undefined],
    ["C:\\Users\\sam\\a.txt:hidden", undefined],
    ["a.txt:stream", undefined],
  ])("%s is %s", (operand, spelled) => {
    expect(shellSpellingOf(operand, "win32")).toBe(spelled);
  });

  it.each(["C:\\Users\\sam\\a.txt", "\\\\?\\C:\\Users\\sam\\a.txt"])(
    "leaves %s outside the chat's folders to the sandbox",
    (operand) => {
      expect(
        openOperandForStdin({
          layout,
          operand,
          platform: "win32",
          resolvePath: (spelled) => path.posix.resolve("/", spelled),
        }),
      ).toBeUndefined();
    },
  );
});
