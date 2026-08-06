import { APP_NAME_SLUG } from "@instrument-org/shared";
import { Bash } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECT_MOUNT_POINT } from "../constants";
import { FolderAttachment } from "../schemas/folder-attachment";
import {
  AbsolutePathSchema,
  TaskDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { withTurnContext } from "./turn-context";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  effectiveFolderAccess,
  SKILLS_MOUNT_POINT,
  TASK_MOUNT_POINT,
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

  async function makeBash(access: FolderAttachment.Access = "read-only") {
    const layout = buildWorkspaceFsLayout({
      attachedFolders: {
        docs: {
          access,
          createdAt: 0,
          id: FolderAttachment.IdSchema.parse("docs-id"),
          mountName: "Docs",
          path: AbsolutePathSchema.parse(path.join(tmpDir, "Docs")),
          source: "user",
        },
      },
      taskHostRoot: TaskDirSchema.parse(path.join(tmpDir, "task")),
    });
    const bashFs = await buildBashFs(layout, {
      maxFileReadSize: 1024 * 1024,
    });
    return new Bash({ cwd: TASK_MOUNT_POINT, fs: bashFs });
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

  it("reads attached folders at their /mnt path", async () => {
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
    ["absolute", `cat ${TASK_MOUNT_POINT}/.instrument/state.json`],
    ["traversal", "cat work/../.instrument/state.json"],
    ["from a subdirectory", "cd work && cat ../.instrument/state.json"],
    ["assembled at runtime", 'd=.instrument; f=state.json; cat "$d/$f"'],
    ["glob", "cat .instrument/*.json"],
    ["via find", "find . -name state.json -exec cat {} +"],
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

  // The project folder mounts writable so the agent can edit the project's own
  // AGENTS.md when asked, which makes the mask over its private dir the thing
  // standing between the agent and the settings naming its attached folders and
  // the access granted to each.
  describe("project mount", () => {
    async function makeProjectBash() {
      await fs.mkdir(path.join(tmpDir, "Proj", ".instrument"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(tmpDir, "Proj", "AGENTS.md"),
        "Use British spelling.",
      );
      await fs.writeFile(
        path.join(tmpDir, "Proj", ".instrument", "settings.json"),
        `{"folders":[{"access":"read-only","path":"/secret"}]}`,
      );
      // The mount resolves the folder name against the workspace, so the
      // projects dir has to be where this test built the folder.
      setWorkspaceConfig({
        ...getWorkspaceConfig(),
        projectsDir: AbsolutePathSchema.parse(tmpDir),
      });
      const layout = buildWorkspaceFsLayout({
        projectFolderName: "Proj",
        taskHostRoot: TaskDirSchema.parse(path.join(tmpDir, "task")),
      });
      const bashFs = await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 });
      return new Bash({ cwd: TASK_MOUNT_POINT, fs: bashFs });
    }

    it("reads the project's instructions at its mount point", async () => {
      const bash = await makeProjectBash();
      const result = await bash.exec(`cat ${PROJECT_MOUNT_POINT}/AGENTS.md`);
      expect(result.stdout).toBe("Use British spelling.");
      expect(result.exitCode).toBe(0);
    });

    it("writes through to the real project folder", async () => {
      const bash = await makeProjectBash();
      const result = await bash.exec(
        `echo 'Prefer pnpm.' >> ${PROJECT_MOUNT_POINT}/AGENTS.md`,
      );
      expect(result.exitCode).toBe(0);
      await expect(
        fs.readFile(path.join(tmpDir, "Proj", "AGENTS.md"), "utf8"),
      ).resolves.toBe("Use British spelling.Prefer pnpm.\n");
    });

    it("masks the project's private dir against reads", async () => {
      const bash = await makeProjectBash();
      expect(
        await stdoutOf(
          bash,
          `cat ${PROJECT_MOUNT_POINT}/.instrument/settings.json`,
        ),
      ).not.toContain("secret");
      expect(
        await stdoutOf(bash, `ls -a ${PROJECT_MOUNT_POINT}`),
      ).not.toContain(".instrument");
    });

    it("refuses writes into the project's private dir", async () => {
      const bash = await makeProjectBash();
      await stdoutOf(
        bash,
        `echo '{"folders":[{"access":"read-write","path":"/"}]}' > ${PROJECT_MOUNT_POINT}/.instrument/settings.json`,
      );
      await expect(
        fs.readFile(
          path.join(tmpDir, "Proj", ".instrument", "settings.json"),
          "utf8",
        ),
      ).resolves.toContain(`"read-only"`);
    });

    it("has no project mount for a task outside a project", async () => {
      const bash = await makeBash();
      const result = await bash.exec("ls /");
      expect(result.stdout).not.toContain("project");
    });
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

  it("skips attached mounts whose folder is missing on disk", async () => {
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
    createMockTaskConfig(TaskIdSchema.parse("skills-mount-test"));
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(tmpDir),
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  async function makeBash() {
    const layout = buildWorkspaceFsLayout({
      taskHostRoot: TaskDirSchema.parse(path.join(tmpDir, "task")),
    });
    const bashFs = await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 });
    return new Bash({ cwd: TASK_MOUNT_POINT, fs: bashFs });
  }

  it("mounts the workspace skills dir writable", async () => {
    const bash = await makeBash();
    const result = await bash.exec(
      `mkdir -p ${SKILLS_MOUNT_POINT}/made-up && echo body > ${SKILLS_MOUNT_POINT}/made-up/SKILL.md`,
    );
    expect(result.exitCode).toBe(0);
    await expect(
      fs.readFile(path.join(tmpDir, "skills", "made-up", "SKILL.md"), "utf8"),
    ).resolves.toBe("body\n");
  });

  it("attributes bash mutations through the mounted filesystem", async () => {
    const bash = await makeBash();
    const turn = {
      id: TaskIdSchema.parse("skills-mount-test"),
      sessionId: StoreId.newSessionId(),
    };
    await beginSkillChangeTracking(turn);

    await withTurnContext(turn, () =>
      bash.exec(
        `mkdir -p ${SKILLS_MOUNT_POINT}/tracked && echo body > ${SKILLS_MOUNT_POINT}/tracked/SKILL.md`,
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
    const listed = await bash.exec(`ls ${SKILLS_MOUNT_POINT}`);
    expect(listed.exitCode).toBe(0);
    const written = await bash.exec(
      `mkdir -p ${SKILLS_MOUNT_POINT}/first && echo body > ${SKILLS_MOUNT_POINT}/first/SKILL.md`,
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
      rootDir: WorkspaceDirSchema.parse(path.join(tmpDir, "workspace")),
    });
  });

  afterEach(async () => {
    setWorkspaceConfig(previousConfig);
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  function accessFor(folderPath: string) {
    return effectiveFolderAccess({
      access: "read-write",
      createdAt: 0,
      id: FolderAttachment.IdSchema.parse("folder-id"),
      mountName: "Folder",
      path: AbsolutePathSchema.parse(folderPath),
      source: "user",
    });
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
});
