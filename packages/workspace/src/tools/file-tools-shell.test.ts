import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { browserScreenshot } from "../lib/browser-screenshot";
import { grantFolder } from "../lib/chat/grants";
import { folderReach } from "../lib/chat/folder-reach";
import { createLocalBashEnv } from "../lib/create-bash-env";
import { FFMPEG_PATH } from "../lib/ffmpeg";
import { updatePermissionSettings } from "../lib/permissions/rules";
import { sessionToolFs } from "../lib/tool-fs";
import { chatDir } from "../lib/record-folders";
import { workDir } from "../lib/work-dir";
import { shellPath } from "../lib/workspace-fs-layout";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { workspaceLayout } from "../lib/workspace-layout";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { runTool } from "../test/helpers/run-tool";
import { EditFile } from "./edit-file";
import { ReadFile } from "./read-file";
import { WriteFile } from "./write-file";

/**
 * The file tools read and write through the shell's own filesystem, so a
 * path the rules keep from the agent is refused by `read_file` exactly where
 * `cat` refuses it, with the note the shell appends, whether it is named
 * outright, reached through `..`, or reached through a symlink.
 */

const model = createMockAIGatewayModel({
  features: [
    "inputImage",
    "inputText",
    "outputText",
    "tools",
  ] satisfies AIGatewayModel.ModelFeatures[],
});

let root: string;
let chatId: ChatId;
let other: ChatId;
let work: string;
let docs: string;
let machine: string;
const sessionId = StoreId.newSessionId();

beforeAll(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "file-tools-shell-")),
  );
  const rootDir = path.join(root, "workspace");
  machine = path.join(root, "machine");
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(workspaceLayout(rootDir).chatsDir),
    userDataDir: AbsolutePathSchema.parse(machine),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    workFoldersDir: AbsolutePathSchema.parse(path.join(machine, "work")),
    workspaceMachineDir: AbsolutePathSchema.parse(machine),
  });
  chatId = await chatFor(sessionId);
  other = await chatFor();
  work = workDir(chatId);
  docs = path.join(root, "Docs");

  await fs.mkdir(path.join(work, "sub"), { recursive: true });
  await fs.writeFile(path.join(work, "notes.md"), "notes\n");
  await fs.mkdir(path.join(workDir(other), "work"), { recursive: true });
  await fs.writeFile(path.join(workDir(other), "work", "theirs.md"), "x\n");
  await fs.writeFile(path.join(chatDir(other), "chat.db"), "x\n");
  await fs.writeFile(path.join(chatDir(chatId), "chat.db"), "x\n");
  await fs.mkdir(path.join(machine, "keys"), { recursive: true });
  await fs.writeFile(path.join(machine, "keys", "provider.json"), "SECRET\n");
  await fs.mkdir(path.join(docs, "locked"), { recursive: true });
  await fs.writeFile(path.join(docs, "locked", "secret.txt"), "secret\n");
  await fs.writeFile(path.join(docs, "open.txt"), "open\n");

  // Links a program the agent runs could leave: in the work folder, to the
  // keys and to a file beside it, and in a granted folder, to a closed one.
  await fs.symlink(
    path.join(machine, "keys", "provider.json"),
    path.join(work, "keys-link"),
  );
  await fs.symlink("notes.md", path.join(work, "notes-link"));
  await fs.symlink(path.join(docs, "locked"), path.join(docs, "locked-link"));

  await grantFolder({ chatId, path: docs, source: "attached" });
  await updatePermissionSettings((settings) => ({
    ...settings,
    folders: [
      {
        addedAt: new Date(),
        level: "never",
        path: AbsolutePathSchema.parse(path.join(docs, "locked")),
      },
    ],
  }));
});

afterAll(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

async function shell(command: string) {
  const bash = await createLocalBashEnv({
    folders: await folderReach(chatId),
    sessionId,
    chatId,
  });
  return bash.exec(command);
}

async function readFile(filePath: string) {
  return runTool(ReadFile, {
    chatId,
    input: { explanation: "read", filePath },
    model,
    sessionId,
    signal: AbortSignal.timeout(30_000),
  });
}

/** What the shell says beyond the command's own `Permission denied` line. */
function noteIn(stderr: string): string {
  return stderr.split("\n").slice(1).join("\n").trim();
}

// Every chat's records are open to reading, so one chat can find what was
// said and done in another.
describe.skipIf(process.platform === "win32")("every chat's records", () => {
  it.each([
    ["another chat's records", () => path.join(chatDir(other), "chat.db")],
    ["the chat's own records", () => path.join(chatDir(chatId), "chat.db")],
  ])("reads %s with cat and read_file alike", async (_label, target) => {
    const typed = target();
    const shown = await shell(`cat '${typed}'`);
    const read = await readFile(typed);

    expect(shown.exitCode).toBe(0);
    expect(read.isOk()).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("a path the rules refuse", () => {
  it.each([
    ["the keys", () => path.join(machine, "keys", "provider.json")],
    [
      "another chat's work folder, through ..",
      () => `../${path.basename(workDir(other))}/work/theirs.md`,
    ],
    ["the folder above the work folder, through ..", () => "../x"],
    [
      "a folder closed in Settings",
      () => path.join(docs, "locked", "secret.txt"),
    ],
    [
      "a folder closed in Settings, through ..",
      () => path.join(docs, "sub", "..", "locked", "secret.txt"),
    ],
    ["a symlink in the work folder to the keys", () => "keys-link"],
    ["a symlink in the work folder to a file beside it", () => "notes-link"],
    [
      "a symlink in a granted folder to a closed one",
      () => path.join(docs, "locked-link", "secret.txt"),
    ],
  ])("refuses %s to cat and read_file alike", async (_label, target) => {
    const typed = target();
    const shown = await shell(`cat '${typed}'`);
    const read = await readFile(typed);

    expect(shown.exitCode).not.toBe(0);
    expect(shown.stdout).toBe("");
    expect(shown.stderr).toContain("Permission denied");
    expect(read.isErr()).toBe(true);
    const message = read.isErr() ? read.error.message : "";
    const note = noteIn(shown.stderr);
    if (note) {
      expect(message).toBe(note);
    } else {
      expect(message).toContain("Permission denied");
    }
  });

  it.each([
    ["the keys", () => path.join(machine, "keys", "provider.json")],
    ["the folder above the work folder, through ..", () => "../escape.md"],
    ["a symlink in the work folder to the keys", () => "keys-link"],
  ])("refuses %s to a redirect and write_file alike", async (_l, target) => {
    const typed = target();
    const shown = await shell(`echo x > '${typed}'`);
    const written = await runTool(WriteFile, {
      chatId,
      input: { content: "x\n", explanation: "write", filePath: typed },
      model,
      sessionId,
      signal: AbortSignal.timeout(30_000),
    });

    expect(shown.exitCode).not.toBe(0);
    expect(written.isErr()).toBe(true);
    const note = noteIn(shown.stderr);
    if (note) {
      expect(written.isErr() && written.error.message).toBe(note);
    }
    expect(
      await fs.readFile(path.join(machine, "keys", "provider.json"), "utf8"),
    ).toBe("SECRET\n");
  });

  it("leaves the keys alone when edit_file is pointed at a link to them", async () => {
    const edited = await runTool(EditFile, {
      chatId,
      input: {
        explanation: "edit",
        filePath: "keys-link",
        newString: "X",
        oldString: "SECRET",
      },
      model,
      sessionId,
      signal: AbortSignal.timeout(30_000),
    });

    expect(edited.isErr()).toBe(true);
    expect(
      await fs.readFile(path.join(machine, "keys", "provider.json"), "utf8"),
    ).toBe("SECRET\n");
  });
});

// A program the agent runs can put a link in the work folder, which is
// where the agent writes, to anything on the disk. Each of these is refused
// to the shell and every file tool, and the file it leads to is left alone.
describe.skipIf(process.platform === "win32")(
  "a link in the work folder to the app's data or a closed folder",
  () => {
    const LINKS = [
      {
        label: "the keys folder",
        link: "keys-dir-link",
        target: () => path.join(machine, "keys"),
        through: "keys-dir-link/provider.json",
        victim: () => path.join(machine, "keys", "provider.json"),
      },
      {
        label: "permissions.json",
        link: "permissions-link",
        target: () => path.join(machine, "permissions.json"),
        through: "permissions-link",
        victim: () => path.join(machine, "permissions.json"),
      },
      {
        label: "another chat's chat.db",
        link: "other-db-link",
        target: () => path.join(chatDir(other), "chat.db"),
        through: "other-db-link",
        victim: () => path.join(chatDir(other), "chat.db"),
      },
      {
        label: "a file in a Not allowed folder",
        link: "locked-file-link",
        target: () => path.join(docs, "locked", "secret.txt"),
        through: "locked-file-link",
        victim: () => path.join(docs, "locked", "secret.txt"),
      },
    ];

    beforeAll(async () => {
      for (const { link, target } of LINKS) {
        await fs.symlink(target(), path.join(work, link));
      }
    });

    it.each(LINKS)(
      "refuses $label to cat, read_file, write_file and edit_file",
      async ({ through, victim }) => {
        const before = await fs.readFile(victim(), "utf8");
        const shown = await shell(`cat '${through}'`);
        const read = await readFile(through);
        const written = await runTool(WriteFile, {
          chatId,
          input: { content: "{}\n", explanation: "write", filePath: through },
          model,
          sessionId,
          signal: AbortSignal.timeout(30_000),
        });
        const edited = await runTool(EditFile, {
          chatId,
          input: {
            explanation: "edit",
            filePath: through,
            newString: "changed",
            oldString: before.slice(0, 4),
          },
          model,
          sessionId,
          signal: AbortSignal.timeout(30_000),
        });

        expect(shown.exitCode).not.toBe(0);
        expect(shown.stdout).toBe("");
        expect(shown.stderr).toContain("Permission denied");
        for (const result of [read, written, edited]) {
          expect(result.isErr() && result.error.message).toContain(
            "Permission denied",
          );
        }
        expect(await fs.readFile(victim(), "utf8")).toBe(before);
      },
    );
  },
);

describe("a path the rules allow", () => {
  it.each([
    ["a file in the work folder", "notes.md", "./notes.md"],
    ["the same, through ..", "sub/../notes.md", "./notes.md"],
    [
      "the same, by its full path",
      () => path.join(work, "notes.md"),
      "./notes.md",
    ],
    [
      "a file in a granted folder",
      () => path.join(docs, "open.txt"),
      // Named back as the shell names it.
      () => shellPath(path.join(docs, "open.txt")),
    ],
  ])("reads %s as cat does", async (_label, typed, expected) => {
    const filePath = typeof typed === "string" ? typed : typed();
    const shown = await shell(`cat '${shellPath(filePath)}'`);
    const read = (await readFile(filePath))._unsafeUnwrap();

    expect(read.state).toBe("exists");
    if (read.state === "exists") {
      expect(read.content).toBe(shown.stdout);
      expect(read.filePath).toBe(
        typeof expected === "string" ? expected : expected(),
      );
    }
  });
});

describe("a name macOS spells another way than the model typed it", () => {
  it.each([
    [
      "a screenshot's narrow no-break space before PM",
      "Screenshot 2026-10-14 at 9.41.03 PM.png",
      "Screenshot 2026-10-14 at 9.41.03\u202FPM.png",
    ],
    ["a decomposed accent", "caf\u00E9.txt", "cafe\u0301.txt"],
    [
      "a curly apostrophe",
      "Capture d'\u00E9cran.txt",
      "Capture d\u2019\u00E9cran.txt",
    ],
    [
      "a decomposed accent with a curly apostrophe",
      "Capture d'\u00E9cran 2.txt",
      "Capture d\u2019e\u0301cran 2.txt",
    ],
  ])("reads %s by the name on disk", async (_label, typed, onDisk) => {
    await fs.writeFile(path.join(work, onDisk), "found\n");
    const read = (await readFile(typed))._unsafeUnwrap();

    expect(read.state).toBe("exists");
    if (read.state === "exists") {
      expect(read.content).toBe("found\n");
      // A disk that ignores how a name is composed finds it as typed.
      expect(read.filePath.normalize("NFC")).toBe(
        `./${onDisk}`.normalize("NFC"),
      );
    }
  });
});

// The app attaches the screenshot a browser command saved to the bash
// result after the whole call has run, by which time a later command in it
// may have put a link at that name.
describe.skipIf(process.platform === "win32")("a browser screenshot", () => {
  async function drawPng(destination: string) {
    await execa(FFMPEG_PATH, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=40x30:duration=1:rate=1",
      "-frames:v",
      "1",
      destination,
    ]);
  }

  async function screenshotAt(hostPath: string) {
    return browserScreenshot({
      files: await sessionToolFs({ chatId, sessionId }),
      hostPath,
      signal: AbortSignal.timeout(30_000),
    });
  }

  it("is shown from the work folder", async () => {
    await drawPng(path.join(work, "shot.png"));

    expect(await screenshotAt(path.join(work, "shot.png"))).toMatchObject({
      height: 30,
      width: 40,
    });
  });

  it("is left out when its name is a link to a closed folder", async () => {
    await drawPng(path.join(docs, "locked", "private.png"));
    await fs.symlink(
      path.join(docs, "locked", "private.png"),
      path.join(work, "shot-link.png"),
    );

    expect(await screenshotAt(path.join(work, "shot-link.png"))).toBe(
      undefined,
    );
  });
});
