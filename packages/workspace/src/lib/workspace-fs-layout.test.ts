import { APP_NAME_SLUG } from "@instrument-org/shared";
import { Bash } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { withTurnContext } from "./turn-context";
import { type Rule } from "./permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { createWalkBudget } from "./walk-budget";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  classifyHostPath,
  effectiveFolderAccess,
  folderHoldsWorkspace,
  hostPathOf,
  outsideFolderRefusal,
  shellPath,
} from "./workspace-fs-layout";
import {
  beginSkillChangeTracking,
  consumeSkillChanges,
} from "./workspace-skill-index";

describe("buildBashFs", () => {
  let tmpDir: string;
  let docs: string;
  let taskDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-bash-fs-test-`),
    );
    docs = path.join(tmpDir, "Docs");
    taskDir = path.join(tmpDir, "task");
    await fs.mkdir(taskDir);
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
      taskHostRoot: ChatDirSchema.parse(taskDir),
    });
    const bashFs = await buildBashFs(layout, {
      maxFileReadSize: 1024 * 1024,
    });
    return new Bash({ cwd: layout.task.shellRoot, fs: bashFs });
  }

  // just-bash raises some filesystem refusals as thrown errors rather than exit
  // codes, and which one a masked path takes depends on the command. Either way
  // the private contents must not reach stdout, so both collapse to "".
  async function stdoutOf(bash: Bash, command: string) {
    try {
      const result = await bash.exec(command.replaceAll("<task>", taskDir));
      return result.stdout;
    } catch {
      return "";
    }
  }

  it("writes relative paths into the real task dir", async () => {
    const bash = await makeBash();
    const result = await bash.exec("echo hi > notes.txt");
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "task", "notes.txt"), "utf8"),
    ).resolves.toBe("hi\n");
  });

  it("reads a folder at its real path", async () => {
    const bash = await makeBash();
    const result = await bash.exec(`cat '${docs}/readme.txt'`);
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
    await expect(bash.exec(`echo nope > '${docs}/new.txt'`)).rejects.toThrow(
      /EACCES/,
    );
    await expect(fs.access(path.join(docs, "new.txt"))).rejects.toThrow();
    const read = await bash.exec(`cat '${docs}/readme.txt'`);
    expect(read.stdout).toBe("hello docs");
  });

  it("refuses to read what the rules close", async () => {
    const bash = await makeBash([
      { level: "never", path: path.join(docs, "readme.txt"), source: "folder" },
    ]);
    const result = await bash.exec(`cat '${docs}/readme.txt'`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
  });

  // A folder has to reach the real disk. OverlayFs would accept every
  // one of these writes into an in-memory layer that is dropped when the bash
  // call ends, so each case asserts against the host filesystem rather than the
  // command's exit code.
  it("writes into a folder through to the real folder", async () => {
    const bash = await makeBash();
    const result = await bash.exec(`echo made > '${docs}/new.txt'`);
    expect(result.exitCode).toBe(0);
    await expect(fs.readFile(path.join(docs, "new.txt"), "utf8")).resolves.toBe(
      "made\n",
    );
  });

  it("moves and deletes inside a folder through to the real folder", async () => {
    const bash = await makeBash();

    const moved = await bash.exec(
      `mkdir -p '${docs}/sorted' && mv '${docs}/readme.txt' '${docs}/sorted/readme.txt'`,
    );
    expect(moved.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(docs, "sorted", "readme.txt"), "utf8"),
    ).resolves.toBe("hello docs");
    await expect(fs.access(path.join(docs, "readme.txt"))).rejects.toThrow();

    const removed = await bash.exec(`rm '${docs}/sorted/readme.txt'`);
    expect(removed.exitCode).toBe(0);
    await expect(
      fs.access(path.join(docs, "sorted", "readme.txt")),
    ).rejects.toThrow();
  });

  it("copies a file from a folder into the chat's own folder", async () => {
    const bash = await makeBash();
    const result = await bash.exec(`cp '${docs}/readme.txt' copy.txt`);
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "task", "copy.txt"), "utf8"),
    ).resolves.toBe("hello docs");
  });

  it("masks the private dir so the agent shell can't read task internals", async () => {
    // A real private file, written the way the app does (direct fs, not the
    // agent's shell).
    await fs.mkdir(path.join(tmpDir, "task", ".instrument"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, "task", ".instrument", "state.json"),
      `{"secret":"host-path"}`,
    );
    const bash = await makeBash();

    const read = await bash.exec("cat .instrument/state.json");
    expect(read.exitCode).not.toBe(0);
    expect(read.stdout).not.toContain("secret");

    const list = await bash.exec("ls .instrument");
    expect(list.stdout).not.toContain("state.json");
  });

  it.each([
    ["absolute", `cat <task>/.instrument/state.json`],
    ["traversal", "cat work/../.instrument/state.json"],
    ["from a subdirectory", "cd work && cat ../.instrument/state.json"],
    ["assembled at runtime", 'd=.instrument; f=state.json; cat "$d/$f"'],
    ["glob", "cat .instrument/*.json"],
    ["via find", "find . -name state.json -exec cat {} +"],
    // A case-insensitive disk (macOS, Windows) opens the same directory.
    ["uppercase", "cat .INSTRUMENT/state.json"],
    ["mixed-case", `cat <task>/.Instrument/state.json`],
  ])(
    "masks the private dir against a %s reference",
    async (_label, command) => {
      await fs.mkdir(path.join(tmpDir, "task", ".instrument"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(tmpDir, "task", ".instrument", "state.json"),
        `{"secret":"host-path"}`,
      );
      await fs.mkdir(path.join(tmpDir, "task", "work"), { recursive: true });
      const bash = await makeBash();

      expect(await stdoutOf(bash, command)).not.toContain("secret");
    },
  );

  it("refuses a symlink that resolves into the private dir", async () => {
    await fs.mkdir(path.join(tmpDir, "task", ".instrument"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, "task", ".instrument", "state.json"),
      `{"secret":"host-path"}`,
    );
    const bash = await makeBash();

    await stdoutOf(bash, "ln -s .instrument/state.json leak.json");
    expect(await stdoutOf(bash, "cat leak.json")).not.toContain("secret");
  });

  it("keeps the private dir out of task-root listings", async () => {
    await fs.mkdir(path.join(tmpDir, "task", ".instrument"), {
      recursive: true,
    });
    await fs.writeFile(path.join(tmpDir, "task", "notes.txt"), "hi");
    const bash = await makeBash();

    const list = await bash.exec("ls -a");
    expect(list.stdout).toContain("notes.txt");
    expect(list.stdout).not.toContain(".instrument");
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
    expect(listed).toContain(tmpDir.split(path.sep)[1]);
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

    it("keeps the workspace missing", async () => {
      const bash = await makeBash();
      const { rootDir } = getWorkspaceConfig();
      await fs.mkdir(rootDir, { recursive: true });
      await fs.writeFile(path.join(rootDir, "secret.txt"), "secret");
      const result = await bash.exec(
        `cat ${rootDir}/secret.txt; ls ${rootDir}`,
      );
      await fs.rm(path.join(rootDir, "secret.txt"));
      expect(result.stdout).not.toContain("secret");
      expect(result.stderr).toContain("No such file or directory");
    });

    it("holds a link to the rules of where it leads", async () => {
      const bash = await makeBash();
      const { rootDir } = getWorkspaceConfig();
      await fs.mkdir(rootDir, { recursive: true });
      await fs.writeFile(path.join(rootDir, "secret.txt"), "secret");
      await fs.symlink(
        path.join(rootDir, "secret.txt"),
        path.join(tmpDir, "link.txt"),
      );
      const result = await bash.exec(`cat ${tmpDir}/link.txt`);
      await fs.rm(path.join(rootDir, "secret.txt"));
      expect(result.stdout).toBe("");
      expect(result.exitCode).not.toBe(0);
    });

    it("stops a walk of the disk at the home folder's budget", async () => {
      const layout = buildWorkspaceFsLayout({
        taskHostRoot: ChatDirSchema.parse(taskDir),
      });
      const bash = new Bash({
        cwd: layout.task.shellRoot,
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
      taskHostRoot: ChatDirSchema.parse(taskDir),
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
    await fs.mkdir(path.join(tmpDir, "skills", "existing"), {
      recursive: true,
    });
    createMockChatConfig(ChatIdSchema.parse("skills-mount-test"));
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      chatsDir: AbsolutePathSchema.parse(path.join(tmpDir, "chats")),
      rootDir: WorkspaceDirSchema.parse(tmpDir),
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  async function makeBash() {
    const layout = buildWorkspaceFsLayout({
      taskHostRoot: ChatDirSchema.parse(path.join(tmpDir, "task")),
    });
    const bashFs = await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 });
    return new Bash({ cwd: layout.task.shellRoot, fs: bashFs });
  }

  const WORKSPACE_SKILLS = () => getWorkspaceSkillsDir();

  it("mounts the workspace skills dir writable", async () => {
    const bash = await makeBash();
    const result = await bash.exec(
      `mkdir -p ${WORKSPACE_SKILLS()}/made-up && echo body > ${WORKSPACE_SKILLS()}/made-up/SKILL.md`,
    );
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "skills", "made-up", "SKILL.md"), "utf8"),
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
    await fs.rm(path.join(tmpDir, "skills"), { force: true, recursive: true });
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
      fs.readFile(path.join(tmpDir, "skills", "first", "SKILL.md"), "utf8"),
    ).resolves.toBe("body\n");
  });
});

describe("effectiveFolderAccess", () => {
  let tmpDir: string;
  let previousConfig: ReturnType<typeof getWorkspaceConfig>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-folder-access-test-`),
    );
    await fs.mkdir(path.join(tmpDir, "workspace"));
    await fs.mkdir(path.join(tmpDir, "elsewhere"));
    previousConfig = getWorkspaceConfig();
    setWorkspaceConfig({
      ...previousConfig,
      chatsDir: AbsolutePathSchema.parse(
        path.join(path.join(tmpDir, "workspace"), "chats"),
      ),
      rootDir: WorkspaceDirSchema.parse(path.join(tmpDir, "workspace")),
    });
  });

  afterEach(async () => {
    setWorkspaceConfig(previousConfig);
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  function accessFor(folderPath: string) {
    return effectiveFolderAccess({ access: "read-write", path: folderPath });
  }

  it("grants read-write to a folder clear of the workspace", () => {
    expect(accessFor(path.join(tmpDir, "elsewhere"))).toBe("read-write");
  });

  // Built by hand rather than with path.join, which would normalize the
  // segments away before the code under test ever sees them. A hand-edited
  // state.json is exactly where an unnormalized path comes from.
  it("refuses a folder that spells the workspace through .. segments", () => {
    expect(accessFor(`${tmpDir}/elsewhere/../workspace`)).toBe("read-only");
  });

  it("refuses a folder that reaches the workspace through a symlink", async () => {
    const link = path.join(tmpDir, "link-to-workspace");
    await fs.symlink(path.join(tmpDir, "workspace"), link);
    expect(accessFor(link)).toBe("read-only");
  });

  it("refuses a folder whose symlinked parent contains the workspace", async () => {
    const link = path.join(tmpDir, "link-to-root");
    await fs.symlink(tmpDir, link);
    expect(accessFor(path.join(link, "workspace", "projects"))).toBe(
      "read-only",
    );
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

  it("knows a folder that holds the workspace from one beside or inside it", async () => {
    expect(folderHoldsWorkspace(tmpDir)).toBe(true);
    const link = path.join(tmpDir, "link-to-root-again");
    await fs.symlink(tmpDir, link);
    expect(folderHoldsWorkspace(link)).toBe(true);
    expect(folderHoldsWorkspace(path.join(tmpDir, "workspace"))).toBe(false);
    expect(folderHoldsWorkspace(path.join(tmpDir, "elsewhere"))).toBe(false);
    expect(folderHoldsWorkspace(path.join(tmpDir, "workspace", "tasks"))).toBe(
      false,
    );
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
    // A task folder inside the home folder, which the layout also mounts:
    // the shape of a chat whose home mount holds its own record.
    home = path.join(tmpDir, "home");
    task = path.join(home, "workspace", "task");
    await fs.mkdir(path.join(task, ".instrument"), { recursive: true });
    await fs.mkdir(path.join(home, "Docs"), { recursive: true });
    await fs.symlink("/etc", path.join(home, "Docs", "out"));
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
      taskHostRoot: ChatDirSchema.parse(task),
    });
  }

  it("names the deepest mount holding a path, by its path there", () => {
    const found = classifyHostPath(layout(), path.join(task, "work", "a.md"));
    expect(found?.shellPath).toBe(path.join(task, "work", "a.md"));
    expect(found?.masked).toBeUndefined();
    expect(found?.escapes).toBe(false);
  });

  it("masks the private dir through a mount that holds it whole", () => {
    const built = layout();
    const homeMount = built.folders[0];
    const found = classifyHostPath(
      built,
      path.join(task, ".instrument", "state.json"),
      homeMount,
    );
    expect(found?.shellPath).toBe(path.join(task, ".instrument", "state.json"));
    expect(found?.masked).toBe(".instrument");
  });

  it("says a path that leaves its mount through a symlink escapes", () => {
    const found = classifyHostPath(
      layout(),
      path.join(home, "Docs", "out", "hosts"),
    );
    expect(found?.shellPath).toBe(path.join(home, "Docs", "out", "hosts"));
    expect(found?.escapes).toBe(true);
  });

  it("follows a path that does not exist yet as far as it does", () => {
    const found = classifyHostPath(
      layout(),
      path.join(home, "Docs", "new", "deeper.md"),
    );
    expect(found).toMatchObject({
      escapes: false,
      shellPath: path.join(home, "Docs", "new", "deeper.md"),
    });
  });

  it.runIf(process.platform === "darwin")(
    "reads another case of a name as the same folder on a disk that ignores case",
    () => {
      const found = classifyHostPath(
        layout(),
        path.join(task, ".INSTRUMENT", "state.json"),
      );
      expect(found?.masked).toBe(".instrument");
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
      taskHostRoot: ChatDirSchema.parse(
        path.join(os.tmpdir(), "chats", "no-drive"),
      ),
    });
    expect(outsideFolderRefusal(layout, "/etc/hosts", "write")).toBe(
      "/etc/hosts is on no drive. On Windows a path starts with its drive, like /c/Users.",
    );
  });
});
