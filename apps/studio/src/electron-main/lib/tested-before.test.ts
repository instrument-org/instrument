import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isTestBuild, workspaceTestedBefore } from "./tested-before";

describe("isTestBuild", () => {
  it("counts 2.x betas and anything before 2.0.0", () => {
    expect(
      Object.fromEntries(
        [
          "2.0.0-beta.61",
          "2.1.0-beta.1",
          "1.9.3",
          "1.10.0-beta.2",
          "0.0.0-test",
          "2.0.0",
          "2.0.1",
          "2.3.0",
          "3.0.0-beta.1",
          "2.0.0-rc.1",
          "not a version",
        ].map((version) => [version, isTestBuild(version)]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "0.0.0-test": true,
        "1.10.0-beta.2": true,
        "1.9.3": true,
        "2.0.0": false,
        "2.0.0-beta.61": true,
        "2.0.0-rc.1": true,
        "2.0.1": false,
        "2.1.0-beta.1": true,
        "2.3.0": false,
        "3.0.0-beta.1": false,
        "not a version": false,
      }
    `);
  });
});

const SESSION = "ses_01JZ0000000000000000000000";
const TASK = "ses_01JZ0000000000000000000001";

let root: string;
let workspacePath: string;
let machineDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tested-before-"));
  workspacePath = path.join(root, "workspace");
  machineDir = path.join(root, "machine");
  fs.mkdirSync(path.join(workspacePath, ".instrument", "chats"), {
    recursive: true,
  });
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

function write(relative: string, content = ""): void {
  const file = path.join(workspacePath, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A chat's log whose header names the build that started its session. */
function log(
  chat: string,
  session: string,
  app: string,
  parent?: string,
): void {
  const header = {
    t: "session",
    at: "2026-10-01T00:00:00.000Z",
    seq: 0,
    format: 1,
    id: session,
    chat,
    createdAt: "2026-10-01T00:00:00.000Z",
    device: "dev_a",
    app,
    ...(parent === undefined ? {} : { parent }),
  };
  write(
    `.instrument/chats/${chat}/${session}.dev_a.jsonl`,
    `${JSON.stringify(header)}\n{"t":"message"}\n`,
  );
}

function testedBefore(): boolean {
  return workspaceTestedBefore({ machineDir, workspacePath });
}

describe("workspaceTestedBefore", () => {
  it("is false with no chats", () => {
    expect(testedBefore()).toBe(false);
  });

  it("is false with no workspace at all", () => {
    fs.rmSync(workspacePath, { force: true, recursive: true });
    expect(testedBefore()).toBe(false);
  });

  it("is true for a chat a beta started", () => {
    log("chat_a", SESSION, "2.0.0-beta.40");
    expect(testedBefore()).toBe(true);
  });

  it("is false for chats a release started", () => {
    log("chat_a", SESSION, "2.0.0");
    log("chat_b", SESSION, "2.1.3");
    expect(testedBefore()).toBe(false);
  });

  it("reads the chat's own session, not a task a beta started in it", () => {
    log("chat_a", TASK, "2.0.0-beta.40", SESSION);
    log("chat_a", SESSION, "2.0.0");
    expect(testedBefore()).toBe(false);
  });

  it("finds one beta chat among release chats", () => {
    log("chat_a", SESSION, "2.0.0");
    log("chat_b", SESSION, "2.0.0-beta.12");
    expect(testedBefore()).toBe(true);
  });

  it("is true for a chat still on a chat.db", () => {
    write(".instrument/chats/chat_a/chat.db");
    expect(testedBefore()).toBe(true);
  });

  it("is true for a 1.x task the migration made into a chat", () => {
    log("chat_a", SESSION, "2.0.0");
    write(".instrument/.pre-chats/task-records/chat_a/task.db");
    expect(testedBefore()).toBe(true);
  });

  it("is true for a 1.x task no migration has moved yet", () => {
    write("tasks/task_a/.instrument/settings.json", "{}");
    expect(testedBefore()).toBe(true);
  });

  it("is false for a person's own tasks folder", () => {
    write("tasks/groceries.md", "milk");
    expect(testedBefore()).toBe(false);
  });

  it("is true for a chat.db converted and set aside on this computer", () => {
    log("chat_a", SESSION, "2.0.0");
    fs.mkdirSync(path.join(machineDir, "set-aside", "chat-db", "chat_a"), {
      recursive: true,
    });
    expect(testedBefore()).toBe(true);
  });

  it("skips a log it cannot read as a header", () => {
    write(`.instrument/chats/chat_a/${SESSION}.dev_a.jsonl`, "not json\n");
    expect(testedBefore()).toBe(false);
  });
});
