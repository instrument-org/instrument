import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { MountedFolder } from "../schemas/mounted-folder";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { mxcTestWorkFoldersDir } from "../test/helpers/mxc-test-config";
import { createBashEnv } from "./create-bash-env";
import { updatePermissionSettings } from "./permissions/rules";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { homeDataLayout } from "./workspace-layout";
import { shellPath } from "./workspace-fs-layout";

// What Studio's postinstall vendors: the uutils, so the text commands are
// programs, and uv, which runs `python`.
const RESOURCES = path.resolve(
  import.meta.dirname,
  "../../../../apps/studio/resources",
);

/**
 * A chat's shell with MXC holding its native commands, on Windows only, in a
 * work folder where the app makes it, `~/.instrument/work/<workspace>/`, and
 * in a granted folder inside Documents, which asks first: git and Windows
 * PowerShell work in both, every chat's work folder is open, the rest of
 * `~/.instrument` and the app's data are closed, and a file in the
 * Documents folder around the grant is refused to a read though its name
 * can be listed. Run it in the interactive
 * session, as the canary's test.
 */
const held =
  process.platform === "win32" &&
  process.env.INSTRUMENT_TEST_MXC_EXEC !== undefined &&
  process.env.INSTRUMENT_MXC === "1";

const sessionId = StoreId.newSessionId();
const secret = randomUUID();
const tag = `mxc-${process.pid}`;
let tmpDir: string;
let chatId: ChatId;
let work: string;
let sibling: string;
let otherWorkspace: string;
let probe: string;
let listOnlyFile: string;
let appFile: string;

async function run(command: string, cwd?: string) {
  const bash = await createBashEnv({
    chatId,
    folders: {
      home: {
        access: "read-write",
        id: MountedFolder.IdSchema.parse("home"),
        path: AbsolutePathSchema.parse(os.homedir()),
      },
    },
    sessionId,
  });
  return bash.exec(cwd ? `cd '${shellPath(cwd)}' && ${command}` : command, {
    signal: AbortSignal.timeout(120_000),
  });
}

/** A node one-liner doing `call` on `target`, the path out of the shell's sight. */
function nodeOn(call: string, target: string): string {
  const encoded = Buffer.from(target).toString("base64");
  return `node -e "const p = Buffer.from('${encoded}', 'base64').toString(); const fs = require('fs'); try { const r = ${call}; console.log('ok', JSON.stringify(r)); } catch (e) { console.log('refused', e.code); }"`;
}

beforeAll(async () => {
  if (!held) {
    return;
  }
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mxc-work-"));
  const records = path.join(tmpDir, "chats", "2026-10-18-mxc-chat");
  await fs.mkdir(records, { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(records));
  const workFolders = mxcTestWorkFoldersDir();
  if (workFolders === undefined) {
    throw new Error("INSTRUMENT_TEST_MXC_EXEC is not set");
  }
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    uutilsDir: AbsolutePathSchema.parse(path.join(RESOURCES, "uutils")),
    uvBinPath: AbsolutePathSchema.parse(path.join(RESOURCES, "uv", "uv.exe")),
    workFoldersDir: AbsolutePathSchema.parse(workFolders),
  });
  work = workDir(chatId);
  await fs.mkdir(work, { recursive: true });
  sibling = path.join(workFolders, "2026-10-18-mxc-sibling");
  await fs.mkdir(sibling, { recursive: true });
  await fs.writeFile(path.join(sibling, "secret.txt"), secret);
  otherWorkspace = path.join(
    homeDataLayout(os.homedir()).workDir,
    `${tag}-other`,
    "2026-10-18-chat",
  );
  await fs.mkdir(otherWorkspace, { recursive: true });
  await fs.writeFile(path.join(otherWorkspace, "secret.txt"), secret);
  const documents = path.join(os.homedir(), "Documents");
  probe = path.join(documents, `${tag}-probe`);
  await fs.mkdir(probe, { recursive: true });
  listOnlyFile = path.join(documents, `${tag}-list-only.txt`);
  await fs.writeFile(listOnlyFile, secret);
  appFile = path.join(homeDataLayout(os.homedir()).dataDir, `${tag}.json`);
  await fs.writeFile(appFile, secret);
  // The workspace's machine folder in the app's data, which the rules close.
  await fs.mkdir(getWorkspaceConfig().workspaceMachineDir, { recursive: true });
  await updatePermissionSettings((settings) => ({
    ...settings,
    folders: [
      {
        addedAt: new Date(),
        level: "allow",
        path: AbsolutePathSchema.parse(probe),
      },
    ],
  }));
});

afterAll(async () => {
  if (!held) {
    return;
  }
  for (const made of [
    tmpDir,
    path.dirname(otherWorkspace),
    probe,
    listOnlyFile,
    appFile,
    path.join(path.dirname(appFile), `${tag}-new.json`),
  ]) {
    await fs.rm(made, { force: true, recursive: true });
  }
});

describe.runIf(held)("a chat's work folder under MXC", () => {
  it("is in ~/.instrument/work", () => {
    expect(path.relative(homeDataLayout(os.homedir()).workDir, work)).toMatch(
      /^instrument-mxc-test-\d+[\\/]2026-10-18-mxc-chat$/,
    );
  });

  it.each([
    ["the work folder", () => work],
    ["a granted folder inside Documents", () => probe],
  ])("runs git in %s", async (_name, folder) => {
    const result = await run(
      "git init -q && git commit --allow-empty -q -m x && git status --short --branch",
      folder(),
    );
    console.log("git", folder(), JSON.stringify(result));
    expect(result.stderr).not.toContain("failed to stat");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^## /);
  });

  it.each([
    ["the work folder", () => work],
    ["a granted folder inside Documents", () => probe],
  ])("starts Windows PowerShell in %s", async (_name, folder) => {
    const result = await run(
      'powershell -NoProfile -Command "(Get-Location).Path"',
      folder(),
    );
    console.log("powershell", folder(), JSON.stringify(result));
    expect(result.exitCode).toBe(0);
    // The shell spells a path a program prints its own way.
    expect(result.stdout.trim().toLowerCase()).toBe(
      shellPath(folder()).toLowerCase(),
    );
  });

  it("runs node there", async () => {
    const result = await run(
      "node -e \"require('fs').writeFileSync('n.txt', 'ok'); console.log(process.cwd())\"",
      work,
    );
    console.log("node", JSON.stringify(result));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().toLowerCase()).toBe(
      shellPath(work).toLowerCase(),
    );
  });

  it("runs python there", async () => {
    const result = await run(
      "python -c \"import os; open('p.txt', 'w').write('ok'); print(os.getcwd())\"",
      work,
    );
    console.log("python", JSON.stringify(result));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().toLowerCase()).toBe(
      shellPath(work).toLowerCase(),
    );
    // The first run installs the managed Python.
  }, 300_000);

  // Chats share their work as they share everything of the person's.
  it.each([
    [
      "read a sibling chat's file",
      "fs.readFileSync(p, 'utf8')",
      () => path.join(sibling, "secret.txt"),
    ],
    [
      "write another workspace's work folder",
      "fs.writeFileSync(p, 'x')",
      () => path.join(otherWorkspace, "new.txt"),
    ],
    [
      "list every workspace's work folders",
      "fs.readdirSync(p).filter((n) => n.startsWith('${tag}') || n.startsWith('instrument-mxc-test-'))",
      () => path.dirname(path.dirname(work)),
    ],
  ])("lets a program %s", async (_name, call, target) => {
    const result = await run(nodeOn(call.replace("${tag}", tag), target()), work);
    console.log("reaches", _name, JSON.stringify(result));
    expect(result.stdout).toMatch(/^ok /);
  });

  it.each([
    [
      "read a file in the list-only Documents",
      "fs.readFileSync(p, 'utf8')",
      () => listOnlyFile,
    ],
    [
      "read what else the app keeps in ~/.instrument",
      "fs.readFileSync(p, 'utf8')",
      () => appFile,
    ],
    [
      "write beside the work folders in ~/.instrument",
      "fs.writeFileSync(p, 'x')",
      () => path.join(path.dirname(appFile), `${tag}-new.json`),
    ],
    [
      "list the app's data folder's machine folders",
      "fs.readdirSync(p)",
      () => path.join(getWorkspaceConfig().userDataDir, "machine"),
    ],
  ])("refuses a program trying to %s", async (_name, call, target) => {
    const result = await run(nodeOn(call, target()), work);
    console.log("refuses", _name, JSON.stringify(result));
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).toMatch(/^refused E(PERM|ACCES)/);
  });

  it("shows a program the names in the list-only Documents", async () => {
    const documents = await run(
      nodeOn(
        "fs.readdirSync(p).filter((n) => n.startsWith('mxc-'))",
        path.dirname(listOnlyFile),
      ),
      work,
    );
    console.log("listing", JSON.stringify(documents));
    expect(documents.stdout).toContain(path.basename(listOnlyFile));
  });
});
