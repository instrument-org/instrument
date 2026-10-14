import { APP_NAME_SLUG } from "@instrument-org/shared";
import { Bash } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceLayout } from "./workspace-layout";
import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { withTurnContext } from "./turn-context";
import { raiseAsk } from "./permissions/asks";
import { type Rule } from "./permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { createWalkBudget } from "./walk-budget";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  classifyHostPath,
  effectiveFolderAccess,
  folderHoldsAppData,
  hostPathOf,
  outsideFolderRefusal,
  shellPath,
} from "./workspace-fs-layout";
import {
  beginSkillChangeTracking,
  consumeSkillChanges,
} from "./workspace-skill-index";

vi.mock("./permissions/asks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./permissions/asks")>()),
  raiseAsk: vi.fn(),
}));

describe("buildBashFs", () => {
  let tmpDir: string;
  let docs: string;
  let chatRoot: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-bash-fs-test-`),
    );
    docs = path.join(tmpDir, "Docs");
    chatRoot = path.join(tmpDir, "task");
    await fs.mkdir(chatRoot);
    await fs.mkdir(docs);
    await fs.writeFile(path.join(docs, "readme.txt"), "hello docs");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  async function makeBash(rules: Rule[] = []) {
    const layout = buildWorkspaceFsLayout({
      folders: {
        docs: {
          access: "read-write",
          id: MountedFolder.IdSchema.parse("docs-id"),
          path: AbsolutePathSchema.parse(docs),
        },
      },
      ...(rules.length > 0 && {
        rules: { home: os.homedir(), rules, withoutAsking: false },
      }),
      chatHostRoot: WorkDirSchema.parse(chatRoot),
    });
    const bashFs = await buildBashFs(layout, {
      maxFileReadSize: 1024 * 1024,
    });
    return new Bash({ cwd: layout.chat.shellRoot, fs: bashFs });
  }

  // just-bash raises some filesystem refusals as thrown errors rather than exit
  // codes, and which one a refused path takes depends on the command. Either
  // way the refused contents must not reach stdout, so both collapse to "".
  async function stdoutOf(bash: Bash, command: string) {
    try {
      const result = await bash.exec(
        command.replaceAll("<chat>", shellPath(chatRoot)),
      );
      return result.stdout;
    } catch {
      return "";
    }
  }

  it("writes relative paths into the real chat folder", async () => {
    const bash = await makeBash();
    const result = await bash.exec("echo hi > notes.txt");
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "task", "notes.txt"), "utf8"),
    ).resolves.toBe("hi\n");
  });

  it("reads a folder at its real path", async () => {
    const bash = await makeBash();
    const result = await bash.exec(`cat '${shellPath(docs)}/readme.txt'`);
    expect(result.stdout).toBe("hello docs");
    expect(result.exitCode).toBe(0);
  });

  // A folder the rules close to changes is refused where it sits. The refusal
  // is raised as a thrown error rather than an exit code; the bash tool
  // converts it to a failed-command result (see tools/bash.ts). Either way the
  // write must not land.
  it("refuses a write the rules keep from a folder", async () => {
    const bash = await makeBash([
      { level: "readOnly", path: docs, source: "system" },
    ]);
    const write = await bash.exec(`echo nope > '${shellPath(docs)}/new.txt'`);
    expect(write.exitCode).toBe(1);
    expect(write.stderr).toBe(
      `bash: ${shellPath(docs)}/new.txt: Permission denied\n`,
    );
    await expect(fs.access(path.join(docs, "new.txt"))).rejects.toThrow();
    const read = await bash.exec(`cat '${shellPath(docs)}/readme.txt'`);
    expect(read.stdout).toBe("hello docs");
  });

  it("refuses to read what the rules close", async () => {
    const bash = await makeBash([
      { level: "never", path: path.join(docs, "readme.txt"), source: "folder" },
    ]);
    const result = await bash.exec(`cat '${shellPath(docs)}/readme.txt'`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
  });

  // macOS reaches its Data volume at / through firmlinks, which realpath
  // leaves alone, so the same file has a second spelling.
  it.runIf(process.platform === "darwin")(
    "refuses to read what the rules close by its Data-volume path",
    async () => {
      const bash = await makeBash([
        {
          level: "never",
          path: path.join(docs, "readme.txt"),
          source: "folder",
        },
      ]);
      const real = await fs.realpath(path.join(docs, "readme.txt"));
      const result = await bash.exec(`cat '/System/Volumes/Data${real}'`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    },
  );

  // A folder has to reach the real disk. OverlayFs would accept every
  // one of these writes into an in-memory layer that is dropped when the bash
  // call ends, so each case asserts against the host filesystem rather than the
  // command's exit code.
  it("writes into a folder through to the real folder", async () => {
    const bash = await makeBash();
    const result = await bash.exec(`echo made > '${shellPath(docs)}/new.txt'`);
    expect(result.exitCode).toBe(0);
    await expect(fs.readFile(path.join(docs, "new.txt"), "utf8")).resolves.toBe(
      "made\n",
    );
  });

  it("moves and deletes inside a folder through to the real folder", async () => {
    const bash = await makeBash();

    const shellDocs = shellPath(docs);
    const moved = await bash.exec(
      `mkdir -p '${shellDocs}/sorted' && mv '${shellDocs}/readme.txt' '${shellDocs}/sorted/readme.txt'`,
    );
    expect(moved.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(docs, "sorted", "readme.txt"), "utf8"),
    ).resolves.toBe("hello docs");
    await expect(fs.access(path.join(docs, "readme.txt"))).rejects.toThrow();

    const removed = await bash.exec(`rm '${shellDocs}/sorted/readme.txt'`);
    expect(removed.exitCode).toBe(0);
    await expect(
      fs.access(path.join(docs, "sorted", "readme.txt")),
    ).rejects.toThrow();
  });

  it("copies a file from a folder into the chat's own folder", async () => {
    const bash = await makeBash();
    const result = await bash.exec(
      `cp '${shellPath(docs)}/readme.txt' copy.txt`,
    );
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "task", "copy.txt"), "utf8"),
    ).resolves.toBe("hello docs");
  });

  // A chat's records sit in the workspace, apart from the work folder the
  // shell starts in: the agent reads what the person sent and writes its
  // handoff notes there, and nothing else of it.
  describe("a chat's record folder", () => {
    let record: string;
    let work: string;
    let otherWork: string;

    beforeEach(async () => {
      const { chatsDir, workspaceMachineDir } = getWorkspaceConfig();
      const name = path.basename(tmpDir);
      record = path.join(chatsDir, name);
      work = path.join(workspaceMachineDir, "work", name);
      otherWork = path.join(workspaceMachineDir, "work", `${name}-other`);
      await fs.mkdir(path.join(record, "attachments"), { recursive: true });
      await fs.mkdir(work, { recursive: true });
      await fs.mkdir(otherWork, { recursive: true });
      await fs.writeFile(path.join(record, "attachments", "sent.txt"), "sent");
      await fs.writeFile(path.join(record, "settings.json"), "secret-settings");
      await fs.writeFile(path.join(record, "chat.db"), "secret-db");
      await fs.writeFile(path.join(otherWork, "theirs.txt"), "secret-other");
    });

    afterEach(async () => {
      await fs.rm(record, { force: true, recursive: true });
      await fs.rm(work, { force: true, recursive: true });
      await fs.rm(otherWork, { force: true, recursive: true });
    });

    async function makeChatBash() {
      const layout = buildWorkspaceFsLayout({
        chatHostRoot: WorkDirSchema.parse(work),
        recordHostRoot: ChatDirSchema.parse(record),
      });
      const bashFs = await buildBashFs(layout, {
        maxFileReadSize: 1024 * 1024,
      });
      return new Bash({ cwd: layout.chat.shellRoot, fs: bashFs });
    }

    it("starts in the work folder", async () => {
      const bash = await makeChatBash();
      const result = await bash.exec("pwd; echo hi > notes.txt");
      expect(result.stdout).toBe(`${shellPath(work)}\n`);
      await expect(
        fs.readFile(path.join(work, "notes.txt"), "utf8"),
      ).resolves.toBe("hi\n");
    });

    it("reads what the person sent and changes none of it", async () => {
      const bash = await makeChatBash();
      const read = await bash.exec(
        `cat '${shellPath(record)}/attachments/sent.txt'`,
      );
      expect(read.stdout).toBe("sent");
      const write = await bash.exec(
        `echo nope > '${shellPath(record)}/attachments/new.txt'`,
      );
      expect(write.exitCode).not.toBe(0);
      expect(existsSync(path.join(record, "attachments", "new.txt"))).toBe(
        false,
      );
    });

    it("writes and reads its handoff notes", async () => {
      const bash = await makeChatBash();
      const notes = `${shellPath(record)}/handoff-notes.md`;
      const result = await bash.exec(`echo notes > '${notes}'; cat '${notes}'`);
      expect(result.stdout).toBe("notes\n");
      await expect(
        fs.readFile(path.join(record, "handoff-notes.md"), "utf8"),
      ).resolves.toBe("notes\n");
    });

    it.each([
      ["the settings", "cat <record>/settings.json"],
      ["the database", "cat <record>/chat.db"],
      ["a listing", "ls <record>"],
      ["a glob", "cat <record>/*.json"],
      ["a traversal", "cat <record>/attachments/../settings.json"],
      [
        "a link from the work folder",
        "ln -s <record>/settings.json leak; cat leak",
      ],
      ["another chat's work folder", "cat <other>/theirs.txt; ls <other>"],
    ])("keeps the rest from the agent: %s", async (_label, command) => {
      const bash = await makeChatBash();
      const stdout = await stdoutOf(
        bash,
        command
          .replaceAll("<record>", shellPath(record))
          .replaceAll("<other>", shellPath(otherWork)),
      );
      expect(stdout).not.toMatch(/secret|chat\.db|settings/);
    });

    it("writes nothing else into the record folder", async () => {
      const bash = await makeChatBash();
      await stdoutOf(bash, `echo planted > '${shellPath(record)}/planted.txt'`);
      expect(existsSync(path.join(record, "planted.txt"))).toBe(false);
    });
  });

  it("rejects writes outside every mount with EROFS instead of losing them", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mkdir -p /tmp && echo scratch > /tmp/x");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("EROFS");
  });

  it("lists the device files at the root beside the folders' parents", async () => {
    const bash = await makeBash();
    const result = await bash.exec("ls /");
    const listed = result.stdout.split("\n").filter(Boolean);
    expect(listed).toContain("dev");
    expect(listed).toContain(shellPath(tmpDir).split("/")[1]);
  });

  describe.skipIf(process.platform === "win32")("outside every mount", () => {
    it("reads the system's own folders and changes nothing there", async () => {
      const bash = await makeBash();
      const result = await bash.exec(
        "cat /etc/hosts | head -1; file /etc/hosts; touch /etc/instrument-test",
      );
      const [first, described] = result.stdout.split("\n");
      expect(first).not.toBe("");
      expect(described).toMatch(/^\/etc\/hosts: .*text/);
      expect(result.stderr).toContain("EROFS");
      expect(existsSync("/etc/instrument-test")).toBe(false);
    });

    it("refuses the workspace's records plainly", async () => {
      const bash = await makeBash();
      const { dataDir } = workspaceLayout(getWorkspaceConfig().rootDir);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, "secret.txt"), "secret");
      const result = await bash.exec(
        `cat ${dataDir}/secret.txt; ls ${dataDir}`,
      );
      await fs.rm(path.join(dataDir, "secret.txt"));
      expect(result.stdout).not.toContain("secret");
      expect(result.stderr).toContain("Permission denied");
      expect(result.stderr).not.toContain("No such file or directory");
    });

    it("holds a link to the rules of where it leads", async () => {
      const bash = await makeBash();
      const { dataDir } = workspaceLayout(getWorkspaceConfig().rootDir);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, "secret.txt"), "secret");
      await fs.symlink(
        path.join(dataDir, "secret.txt"),
        path.join(tmpDir, "link.txt"),
      );
      const result = await bash.exec(`cat ${tmpDir}/link.txt`);
      await fs.rm(path.join(dataDir, "secret.txt"));
      expect(result.stdout).toBe("");
      expect(result.exitCode).not.toBe(0);
    });

    it("stops a walk of the disk at the home folder's budget", async () => {
      const layout = buildWorkspaceFsLayout({
        chatHostRoot: WorkDirSchema.parse(chatRoot),
      });
      const bash = new Bash({
        cwd: layout.chat.shellRoot,
        fs: await buildBashFs(layout, {
          homeWalkBudget: createWalkBudget(50),
          maxFileReadSize: 1024 * 1024,
        }),
      });
      const result = await bash.exec("find /usr -name nothing-is-named-this");
      expect(result.stderr).toContain("stopped walking / after 50 entries");
    });
  });

  // A write to a path outside every mount throws rather than returning an exit
  // code, which drops the output of every command that already ran in the same
  // call -- so an unbacked /dev/null would lose far more than it discards.
  it.each(["> /dev/null", "1> /dev/null"])(
    "discards stdout redirected with %s and keeps running",
    async (redirect) => {
      const bash = await makeBash();
      const result = await bash.exec(`echo discarded ${redirect}; echo kept`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("kept");
      expect(result.stdout).not.toContain("discarded");
    },
  );

  it("discards stderr redirected to /dev/null and keeps running", async () => {
    const bash = await makeBash();
    const result = await bash.exec("ls /nope 2> /dev/null; echo kept");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("kept");
    expect(result.stderr).toBe("");
  });

  it("leaves a folder that is missing on disk missing", async () => {
    const gone = path.join(tmpDir, "unplugged-drive");
    const layout = buildWorkspaceFsLayout({
      folders: {
        gone: {
          access: "read-write",
          id: MountedFolder.IdSchema.parse("gone-id"),
          path: AbsolutePathSchema.parse(gone),
        },
      },
      chatHostRoot: WorkDirSchema.parse(chatRoot),
    });
    await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 });
    expect(existsSync(gone)).toBe(false);
  });
});

describe("buildBashFs skills mount", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-skills-fs-test-`),
    );
    await fs.mkdir(path.join(tmpDir, "task"));
    await fs.mkdir(path.join(workspaceLayout(tmpDir).skillsDir, "existing"), {
      recursive: true,
    });
    createMockChatConfig(ChatIdSchema.parse("skills-mount-test"));
    // The mock's folders for the app are POSIX fixtures, which name no drive
    // on Windows, so this computer's folder sits in the temp folder too.
    const machine = path.join(tmpDir, "machine");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      appsDir: AbsolutePathSchema.parse(workspaceLayout(tmpDir).appsDir),
      chatsDir: AbsolutePathSchema.parse(workspaceLayout(tmpDir).chatsDir),
      machineDir: AbsolutePathSchema.parse(machine),
      rootDir: WorkspaceDirSchema.parse(tmpDir),
      runtimeDir: AbsolutePathSchema.parse(path.join(machine, "runtime")),
      workFoldersDir: AbsolutePathSchema.parse(path.join(machine, "work")),
      workspaceMachineDir: AbsolutePathSchema.parse(machine),
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  async function makeBash() {
    const layout = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(path.join(tmpDir, "task")),
    });
    const bashFs = await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 });
    return new Bash({ cwd: layout.chat.shellRoot, fs: bashFs });
  }

  const WORKSPACE_SKILLS = () => shellPath(getWorkspaceSkillsDir());

  it("mounts the workspace skills dir writable", async () => {
    const bash = await makeBash();
    const result = await bash.exec(
      `mkdir -p ${WORKSPACE_SKILLS()}/made-up && echo body > ${WORKSPACE_SKILLS()}/made-up/SKILL.md`,
    );
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(
        path.join(workspaceLayout(tmpDir).skillsDir, "made-up", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toBe("body\n");
  });

  it("attributes bash mutations through the mounted filesystem", async () => {
    const bash = await makeBash();
    const turn = {
      id: ChatIdSchema.parse("skills-mount-test"),
      sessionId: StoreId.newSessionId(),
    };
    await beginSkillChangeTracking(turn);

    await withTurnContext(turn, () =>
      bash.exec(
        `mkdir -p ${WORKSPACE_SKILLS()}/tracked && echo body > ${WORKSPACE_SKILLS()}/tracked/SKILL.md`,
      ),
    );

    await expect(consumeSkillChanges(turn)).resolves.toMatchObject({
      created: ["tracked"],
    });
  });

  it("provisions the mount when the workspace has no skills dir yet", async () => {
    await fs.rm(workspaceLayout(tmpDir).skillsDir, {
      force: true,
      recursive: true,
    });
    const bash = await makeBash();
    // The prompt names the skills folder unconditionally, so it has to be
    // there to write to even before the first skill exists.
    const listed = await bash.exec(`ls ${WORKSPACE_SKILLS()}`);
    expect(listed.exitCode).toBe(0);
    const written = await bash.exec(
      `mkdir -p ${WORKSPACE_SKILLS()}/first && echo body > ${WORKSPACE_SKILLS()}/first/SKILL.md`,
    );
    expect(written.exitCode).toBe(0);
    await expect(
      fs.readFile(
        path.join(workspaceLayout(tmpDir).skillsDir, "first", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toBe("body\n");
  });
});

describe("effectiveFolderAccess", () => {
  let tmpDir: string;
  let previousConfig: ReturnType<typeof getWorkspaceConfig>;

  // This computer's folder for the app, and a workspace in a folder the
  // person picked, in their Documents.
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-folder-access-test-`),
    );
    await fs.mkdir(path.join(tmpDir, "machine"));
    await fs.mkdir(path.join(tmpDir, "Documents", "picked", ".instrument"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpDir, "elsewhere"));
    previousConfig = getWorkspaceConfig();
    setWorkspaceConfig({
      ...previousConfig,
      chatsDir: AbsolutePathSchema.parse(
        workspaceLayout(path.join(tmpDir, "Documents", "picked")).chatsDir,
      ),
      machineDir: AbsolutePathSchema.parse(path.join(tmpDir, "machine")),
      rootDir: WorkspaceDirSchema.parse(
        path.join(tmpDir, "Documents", "picked"),
      ),
    });
  });

  afterEach(async () => {
    setWorkspaceConfig(previousConfig);
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  function accessFor(folderPath: string) {
    return effectiveFolderAccess({ access: "read-write", path: folderPath });
  }

  it("grants read-write to a folder clear of the app's data", () => {
    expect(accessFor(path.join(tmpDir, "elsewhere"))).toBe("read-write");
  });

  it("grants read-write to the workspace's own folder and one holding it", () => {
    expect(accessFor(path.join(tmpDir, "Documents", "picked"))).toBe(
      "read-write",
    );
    expect(accessFor(path.join(tmpDir, "Documents"))).toBe("read-write");
  });

  it("refuses a folder inside the workspace's .instrument/ or this computer's folder", () => {
    expect(
      accessFor(path.join(tmpDir, "Documents", "picked", ".instrument", "x")),
    ).toBe("read-only");
    expect(accessFor(path.join(tmpDir, "machine", "x"))).toBe("read-only");
  });

  // Built by hand rather than with path.join, which would normalize the
  // segments away before the code under test ever sees them. A hand-edited
  // state.json is exactly where an unnormalized path comes from.
  it("refuses a folder that spells this computer's folder through .. segments", () => {
    expect(accessFor(`${tmpDir}/elsewhere/../machine`)).toBe("read-only");
  });

  it("refuses a folder that reaches this computer's folder through a symlink", async () => {
    const link = path.join(tmpDir, "link-to-machine");
    await fs.symlink(path.join(tmpDir, "machine"), link);
    expect(accessFor(link)).toBe("read-only");
  });

  it("refuses a folder whose symlinked parent contains this computer's folder", async () => {
    const link = path.join(tmpDir, "link-to-root");
    await fs.symlink(tmpDir, link);
    expect(accessFor(path.join(link, "machine", "keys"))).toBe("read-only");
  });

  it("judges the folder given rather than the attachment it came from", () => {
    expect(
      effectiveFolderAccess({
        access: "read-write",
        path: path.join(tmpDir, "elsewhere"),
      }),
    ).toBe("read-write");
    expect(effectiveFolderAccess({ access: "read-write", path: tmpDir })).toBe(
      "read-only",
    );
  });

  it("knows a folder that holds this computer's folder from one beside or inside it", async () => {
    expect(folderHoldsAppData(tmpDir)).toBe(true);
    const link = path.join(tmpDir, "link-to-root-again");
    await fs.symlink(tmpDir, link);
    expect(folderHoldsAppData(link)).toBe(true);
    expect(folderHoldsAppData(path.join(tmpDir, "machine"))).toBe(false);
    expect(folderHoldsAppData(path.join(tmpDir, "elsewhere"))).toBe(false);
    expect(folderHoldsAppData(path.join(tmpDir, "machine", "keys"))).toBe(
      false,
    );
    expect(folderHoldsAppData(path.join(tmpDir, "Documents"))).toBe(false);
  });
});

describe("classifyHostPath", () => {
  let tmpDir: string;
  let home: string;
  let task: string;

  beforeEach(async () => {
    tmpDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), `${APP_NAME_SLUG}-classify-`)),
    );
    // A work folder inside the home folder, which the layout also mounts:
    // the shape of a chat whose home mount holds its own work folder.
    home = path.join(tmpDir, "home");
    task = path.join(home, "workspace", "task");
    await fs.mkdir(task, { recursive: true });
    await fs.mkdir(path.join(home, "Docs"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "elsewhere"));
    await fs.symlink(
      path.join(tmpDir, "elsewhere"),
      path.join(home, "Docs", "out"),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  function layout() {
    return buildWorkspaceFsLayout({
      folders: {
        Home: {
          access: "read-only",
          id: MountedFolder.IdSchema.parse("home-id"),
          path: AbsolutePathSchema.parse(home),
        },
      },
      chatHostRoot: WorkDirSchema.parse(task),
    });
  }

  it("names the deepest mount holding a path, by its path there", () => {
    const found = classifyHostPath(layout(), path.join(task, "work", "a.md"));
    expect(found?.shellPath).toBe(shellPath(path.join(task, "work", "a.md")));
    expect(found?.mount.hostRoot).toBe(task);
    expect(found?.escapes).toBe(false);
  });

  it("says a path that leaves its mount through a symlink escapes", () => {
    const found = classifyHostPath(
      layout(),
      path.join(home, "Docs", "out", "hosts"),
    );
    expect(found?.shellPath).toBe(
      shellPath(path.join(home, "Docs", "out", "hosts")),
    );
    expect(found?.escapes).toBe(true);
  });

  it("follows a path that does not exist yet as far as it does", () => {
    const found = classifyHostPath(
      layout(),
      path.join(home, "Docs", "new", "deeper.md"),
    );
    expect(found).toMatchObject({
      escapes: false,
      shellPath: shellPath(path.join(home, "Docs", "new", "deeper.md")),
    });
  });

  it.runIf(process.platform === "darwin")(
    "reads another case of a name as the same folder on a disk that ignores case",
    () => {
      expect(
        classifyHostPath(layout(), path.join(home.toUpperCase(), "Docs"))
          ?.shellPath,
      ).toBe(path.join(home, "Docs"));
    },
  );

  it("knows nothing of a path outside every mount", () => {
    expect(classifyHostPath(layout(), tmpDir)).toBeNull();
  });
});

describe.runIf(process.platform !== "win32")("outsideFolderRefusal", () => {
  let tmpDir: string;
  let drives: string;

  beforeEach(async () => {
    vi.mocked(raiseAsk).mockClear();
    tmpDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "outside-folder-")),
    );
    drives = path.join(tmpDir, "Volumes");
    await fs.mkdir(path.join(drives, "Backup", "photos", "2026"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  function layoutWith(level: "allow" | "ask") {
    return buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(path.join(tmpDir, "chat")),
      rules: {
        asker: {
          chatId: ChatIdSchema.parse("outside-folder-test"),
          sessionId: StoreId.newSessionId(),
        },
        home: path.join(tmpDir, "home"),
        rules: [{ level, path: drives, place: "drives", source: "place" }],
        withoutAsking: false,
      },
    });
  }

  it("asks for the folder one level into the place, as a mount's refusal does", () => {
    const refusal = outsideFolderRefusal(
      layoutWith("ask"),
      path.join(drives, "Backup", "photos", "2026", "new.jpg"),
      "write",
    );
    expect(vi.mocked(raiseAsk).mock.calls.map((call) => call[2])).toEqual([
      path.join(drives, "Backup"),
    ]);
    expect(refusal).toContain(
      `Waiting on the person to allow "${drives}/Backup".`,
    );
  });

  it("asks nothing for a place set to Allowed, or a read no rule holds", async () => {
    const log = path.join(tmpDir, "log", "install.log");
    await fs.mkdir(path.dirname(log));
    await fs.writeFile(log, "x");
    const allowed = layoutWith("allow");
    const photo = path.join(drives, "Backup", "photos", "2026", "a.jpg");
    expect([
      outsideFolderRefusal(allowed, photo, "write"),
      outsideFolderRefusal(allowed, path.dirname(photo), "read"),
      outsideFolderRefusal(layoutWith("ask"), log, "read"),
    ]).toEqual([undefined, undefined, undefined]);
    expect(raiseAsk).not.toHaveBeenCalled();
  });
});

describe("shellPath on Windows", () => {
  const platform = process.platform;
  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32" });
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
  });

  it.each([
    ["C:\\Users\\sam\\notes.md", "/c/Users/sam/notes.md"],
    ["D:\\Photos\\2026", "/d/Photos/2026"],
    ["E:\\", "/e"],
  ])("spells %s as %s and back", (host, shell) => {
    expect(shellPath(host)).toBe(shell);
    expect(hostPathOf(shell)).toBe(host);
  });

  it("keeps a network share's server and share", () => {
    expect(shellPath("\\\\nas\\media\\a.mp4")).toBe("//nas/media/a.mp4");
    expect(hostPathOf("//nas/media/a.mp4")).toBe("\\\\nas\\media\\a.mp4");
  });

  it("finds /tmp in the temp folder, as Git Bash does", () => {
    expect(hostPathOf("/tmp")).toBe(path.win32.join(os.tmpdir()));
    expect(hostPathOf("/tmp/a/b.txt")).toBe(
      path.win32.join(os.tmpdir(), "a", "b.txt"),
    );
  });

  it("refuses a path on no drive without resolving it", () => {
    const layout = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(
        path.join(os.tmpdir(), "chats", "no-drive"),
      ),
    });
    expect(outsideFolderRefusal(layout, "/etc/hosts", "write")).toBe(
      "/etc/hosts is on no drive. On Windows a path starts with its drive, like /c/Users.",
    );
  });
});
