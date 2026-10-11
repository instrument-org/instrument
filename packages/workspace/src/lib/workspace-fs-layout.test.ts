import { APP_NAME_SLUG } from "@instrument-org/shared";
import { Bash } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MOUNT } from "../mount-points";

/** The workspace's own skills, now one source segment among several. */
const WORKSPACE_SKILLS = `${MOUNT.skills}/workspace`;
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
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  classifyHostPath,
  effectiveFolderAccess,
  folderHoldsWorkspace,
} from "./workspace-fs-layout";
import {
  beginSkillChangeTracking,
  consumeSkillChanges,
} from "./workspace-skill-index";

describe("buildBashFs", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-bash-fs-test-`),
    );
    await fs.mkdir(path.join(tmpDir, "task"));
    await fs.mkdir(path.join(tmpDir, "Docs"));
    await fs.writeFile(path.join(tmpDir, "Docs", "readme.txt"), "hello docs");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  async function makeBash(access: MountedFolder.Access = "read-only") {
    const layout = buildWorkspaceFsLayout({
      folders: {
        docs: {
          access,
          id: MountedFolder.IdSchema.parse("docs-id"),
          mountName: "Docs",
          path: AbsolutePathSchema.parse(path.join(tmpDir, "Docs")),
        },
      },
      taskHostRoot: ChatDirSchema.parse(path.join(tmpDir, "task")),
    });
    const bashFs = await buildBashFs(layout, {
      maxFileReadSize: 1024 * 1024,
    });
    return new Bash({ cwd: MOUNT.task, fs: bashFs });
  }

  // just-bash raises some filesystem refusals as thrown errors rather than exit
  // codes, and which one a masked path takes depends on the command. Either way
  // the private contents must not reach stdout, so both collapse to "".
  async function stdoutOf(bash: Bash, command: string) {
    try {
      const result = await bash.exec(command);
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

  it("reads folder mounts at their /mnt path", async () => {
    const bash = await makeBash();
    const result = await bash.exec("cat '/mnt/Docs/readme.txt'");
    expect(result.stdout).toBe("hello docs");
    expect(result.exitCode).toBe(0);
  });

  it("rejects writes into a read-only mount with EROFS", async () => {
    const bash = await makeBash();
    // just-bash raises redirect-target failures as thrown errors rather than
    // exit codes; the bash tool converts them to a failed-command result (see
    // tools/bash.ts). Either way the write must not land.
    await expect(bash.exec("echo nope > '/mnt/Docs/new.txt'")).rejects.toThrow(
      /EROFS/,
    );
    await expect(
      fs.access(path.join(tmpDir, "Docs", "new.txt")),
    ).rejects.toThrow();
  });

  // A read-write mount has to reach the real disk. OverlayFs would accept every
  // one of these writes into an in-memory layer that is dropped when the bash
  // call ends, so each case asserts against the host filesystem rather than the
  // command's exit code.
  it("writes into a read-write mount through to the real folder", async () => {
    const bash = await makeBash("read-write");
    const result = await bash.exec("echo made > '/mnt/Docs/new.txt'");
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "Docs", "new.txt"), "utf8"),
    ).resolves.toBe("made\n");
  });

  it("moves and deletes inside a read-write mount through to the real folder", async () => {
    const bash = await makeBash("read-write");

    const moved = await bash.exec(
      "mkdir -p '/mnt/Docs/sorted' && mv '/mnt/Docs/readme.txt' '/mnt/Docs/sorted/readme.txt'",
    );
    expect(moved.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "Docs", "sorted", "readme.txt"), "utf8"),
    ).resolves.toBe("hello docs");
    await expect(
      fs.access(path.join(tmpDir, "Docs", "readme.txt")),
    ).rejects.toThrow();

    const removed = await bash.exec("rm '/mnt/Docs/sorted/readme.txt'");
    expect(removed.exitCode).toBe(0);
    await expect(
      fs.access(path.join(tmpDir, "Docs", "sorted", "readme.txt")),
    ).rejects.toThrow();
  });

  it("copies a file from a read-write mount into the task", async () => {
    const bash = await makeBash("read-write");
    const result = await bash.exec("cp '/mnt/Docs/readme.txt' copy.txt");
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "task", "copy.txt"), "utf8"),
    ).resolves.toBe("hello docs");
  });

  it("masks the private dir so the agent shell can't read task internals", async () => {
    // A real private file, written the way the app does (direct fs, not the
    // virtual FS).
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
    ["absolute", `cat ${MOUNT.task}/.instrument/state.json`],
    ["traversal", "cat work/../.instrument/state.json"],
    ["from a subdirectory", "cd work && cat ../.instrument/state.json"],
    ["assembled at runtime", 'd=.instrument; f=state.json; cat "$d/$f"'],
    ["glob", "cat .instrument/*.json"],
    ["via find", "find . -name state.json -exec cat {} +"],
    // A case-insensitive disk (macOS, Windows) opens the same directory.
    ["uppercase", "cat .INSTRUMENT/state.json"],
    ["mixed-case", `cat ${MOUNT.task}/.Instrument/state.json`],
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

  it("lists the mount points at the virtual root", async () => {
    const bash = await makeBash();
    const result = await bash.exec("ls /");
    expect(result.stdout.split("\n").filter(Boolean).sort()).toEqual([
      "dev",
      "mnt",
      "skills",
      "task",
    ]);
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

  it("skips folder mounts whose folder is missing on disk", async () => {
    await fs.rm(path.join(tmpDir, "Docs"), { force: true, recursive: true });
    const bash = await makeBash();
    const result = await bash.exec("ls '/mnt/Docs'");
    expect(result.exitCode).not.toBe(0);
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
    return new Bash({ cwd: MOUNT.task, fs: bashFs });
  }

  it("mounts the workspace skills dir writable", async () => {
    const bash = await makeBash();
    const result = await bash.exec(
      `mkdir -p ${WORKSPACE_SKILLS}/made-up && echo body > ${WORKSPACE_SKILLS}/made-up/SKILL.md`,
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
        `mkdir -p ${WORKSPACE_SKILLS}/tracked && echo body > ${WORKSPACE_SKILLS}/tracked/SKILL.md`,
      ),
    );

    await expect(consumeSkillChanges(turn)).resolves.toMatchObject({
      created: ["tracked"],
    });
  });

  it("lists the skills mount at the virtual root", async () => {
    const bash = await makeBash();
    const result = await bash.exec("ls /");
    expect(result.stdout.split("\n").filter(Boolean).sort()).toEqual([
      "dev",
      "skills",
      "task",
    ]);
  });

  it("provisions the mount when the workspace has no skills dir yet", async () => {
    await fs.rm(path.join(tmpDir, "skills"), { force: true, recursive: true });
    const bash = await makeBash();
    // The prompt advertises /skills unconditionally, so it has to be there to
    // write to even before the first skill exists.
    const listed = await bash.exec(`ls ${WORKSPACE_SKILLS}`);
    expect(listed.exitCode).toBe(0);
    const written = await bash.exec(
      `mkdir -p ${WORKSPACE_SKILLS}/first && echo body > ${WORKSPACE_SKILLS}/first/SKILL.md`,
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
          mountName: "Home",
          path: AbsolutePathSchema.parse(home),
        },
      },
      taskHostRoot: ChatDirSchema.parse(task),
    });
  }

  it("names the deepest mount holding a path, by its path there", () => {
    const found = classifyHostPath(layout(), path.join(task, "work", "a.md"));
    expect(found?.virtualPath).toBe("/task/work/a.md");
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
    expect(found?.virtualPath).toBe(
      "/mnt/Home/workspace/task/.instrument/state.json",
    );
    expect(found?.masked).toBe(".instrument");
  });

  it("says a path that leaves its mount through a symlink escapes", () => {
    const found = classifyHostPath(
      layout(),
      path.join(home, "Docs", "out", "hosts"),
    );
    expect(found?.virtualPath).toBe("/mnt/Home/Docs/out/hosts");
    expect(found?.escapes).toBe(true);
  });

  it("follows a path that does not exist yet as far as it does", () => {
    const found = classifyHostPath(
      layout(),
      path.join(home, "Docs", "new", "deeper.md"),
    );
    expect(found).toMatchObject({
      escapes: false,
      virtualPath: "/mnt/Home/Docs/new/deeper.md",
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
          ?.virtualPath,
      ).toBe("/mnt/Home/Docs");
    },
  );

  it("knows nothing of a path outside every mount", () => {
    expect(classifyHostPath(layout(), tmpDir)).toBeNull();
  });
});
