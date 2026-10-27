import {
  APP_NAME_SLUG,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import { Bash } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { workspaceLayout } from "./workspace-layout";
import { SKILLS_FOLDER_NAME } from "../constants";
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
  noteFoundProgram,
  outsideFolderRefusal,
  shellPath,
  shellPathOfHostSpelling,
} from "./workspace-fs-layout";
import { beginSetupChangeTracking, consumeSetupChanges } from "./setup-changes";

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
        rules: {
          home: os.homedir(),
          rules,
          dangerouslyAllowEveryFolder: false,
        },
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

    it("names the chat's own folder, where its finished work goes", async () => {
      await fs.writeFile(
        path.join(
          getWorkspaceConfig().workspaceMachineDir,
          WORKSPACE_MACHINE_ENTRIES.chatFolders,
        ),
        JSON.stringify({ [path.basename(record)]: "Quiet dishwashers" }),
      );

      const layout = buildWorkspaceFsLayout({
        chatHostRoot: WorkDirSchema.parse(work),
        recordHostRoot: ChatDirSchema.parse(record),
      });

      expect(layout.folder?.hostRoot).toBe(
        path.join(getWorkspaceConfig().rootDir, "Chats", "Quiet dishwashers"),
      );
    });

    it("names no folder for a chat this computer recorded none for", async () => {
      const layout = buildWorkspaceFsLayout({
        chatHostRoot: WorkDirSchema.parse(work),
        recordHostRoot: ChatDirSchema.parse(record),
      });

      expect(layout.folder).toBeUndefined();
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

    // The workspace folder is one every chat reaches (`folderReach`), and
    // a draft in it can ask a computer to send it.
    it("reads a draft in the workspace it reaches and changes none of the drafts", async () => {
      const root = getWorkspaceConfig().rootDir;
      const drafts = path.join(root, "Drafts");
      await fs.mkdir(path.join(drafts, "2026-10-27"), { recursive: true });
      await fs.writeFile(path.join(drafts, "2026-10-27", "DRAFT.md"), "words");
      const layout = buildWorkspaceFsLayout({
        chatHostRoot: WorkDirSchema.parse(work),
        folders: {
          workspace: {
            access: "read-write",
            id: MountedFolder.IdSchema.parse("workspace-id"),
            path: AbsolutePathSchema.parse(root),
          },
        },
        recordHostRoot: ChatDirSchema.parse(record),
      });
      const bash = new Bash({
        cwd: layout.chat.shellRoot,
        fs: await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 }),
      });
      const read = await bash.exec(
        `cat '${shellPath(drafts)}/2026-10-27/DRAFT.md'`,
      );
      expect(read.stdout).toBe("words");
      // The rest of the workspace stays the agent's to change.
      const elsewhere = await bash.exec(
        `echo ok > '${shellPath(root)}/notes.md'`,
      );
      expect(elsewhere.exitCode).toBe(0);
      const write = await bash.exec(
        `mkdir -p '${shellPath(drafts)}/new'; echo send > '${shellPath(drafts)}/new/DRAFT.md'`,
      );
      expect(write.exitCode).not.toBe(0);
      expect(existsSync(path.join(drafts, "new", "DRAFT.md"))).toBe(false);
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

    // Every chat's records are open to reading, so one chat can find what
    // was said and done in another.
    it.each([
      ["the settings", "cat <record>/settings.json"],
      ["the database", "cat <record>/chat.db"],
      ["a listing", "ls <record>"],
      ["a glob", "cat <record>/*.json"],
      ["a traversal", "cat <record>/attachments/../settings.json"],
    ])("reads the rest of it: %s", async (_label, command) => {
      const bash = await makeChatBash();
      const stdout = await stdoutOf(
        bash,
        command.replaceAll("<record>", shellPath(record)),
      );
      expect(stdout).toMatch(/secret|chat\.db|settings/);
    });

    it.each([
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

  // A virtual path spells its separator "/" whatever this computer writes
  // between the names of its own, which is what the just-bash patch's
  // virtual-path separators part keeps true on Windows: a path answered with
  // backslashes in it names nothing the shell's own filesystem can find,
  // and a write to it lands outside every mount.
  it("answers realpath with a path the shell can use again", async () => {
    const layout = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(chatRoot),
    });
    const bashFs = await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 });
    await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
    await fs.writeFile(path.join(chatRoot, "work", "notes.txt"), "hi\n");
    const named = `${layout.chat.shellRoot}/work/notes.txt`;

    await expect(bashFs.realpath(named)).resolves.toBe(named);
  });

  it("rejects writes outside every mount with EROFS instead of losing them", async () => {
    const bash = await makeBash();
    const result = await bash.exec("mkdir -p /tmp && echo scratch > /tmp/x");
    expect(result.exitCode).not.toBe(0);
    // The code where the write is refused outside a mount, and the sentence
    // a redirect turns it into, which is what a Linux host reports for the
    // same refusal since `/tmp` is a path of its own there.
    expect(result.stderr).toMatch(/EROFS|Read-only file system/);
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

  // `~/walk-work` granted, leading into a closed `~/Documents`: the grant's
  // own spelling reaches the folder it opens, and nothing else in Documents.
  describe.skipIf(process.platform === "win32")(
    "a granted link into a closed folder",
    () => {
      async function linkedBash() {
        const home = path.join(await fs.realpath(tmpDir), "home");
        const documents = path.join(home, "Documents");
        const target = path.join(documents, "walk-work");
        const link = path.join(home, "walk-work");
        await fs.mkdir(target, { recursive: true });
        await fs.writeFile(path.join(target, "notes.txt"), "walk notes");
        await fs.writeFile(path.join(documents, "secret.txt"), "secret");
        await fs.symlink(target, link);
        const folder = (id: string, folderPath: string) => ({
          access: "read-write" as const,
          id: MountedFolder.IdSchema.parse(id),
          path: AbsolutePathSchema.parse(folderPath),
        });
        const layout = buildWorkspaceFsLayout({
          folders: {
            home: folder("home-id", home),
            link: folder("link-id", link),
          },
          rules: {
            dangerouslyAllowEveryFolder: false,
            home,
            rules: [
              { level: "allow", path: home, source: "system" },
              { level: "ask", path: documents, source: "place" },
              { level: "allow", path: link, source: "grant" },
            ],
          },
          chatHostRoot: WorkDirSchema.parse(chatRoot),
        });
        const bash = new Bash({
          cwd: layout.chat.shellRoot,
          fs: await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 }),
        });
        return { bash, documents, link: shellPath(link), target };
      }

      it.each([
        ["cd", (link: string) => `cd ${link} && cat notes.txt`, "walk notes"],
        ["cat", (link: string) => `cat ${link}/notes.txt`, "walk notes"],
        ["ls", (link: string) => `ls ${link}`, "notes.txt\n"],
      ])("reads through the link with %s", async (_, command, stdout) => {
        const { bash, link } = await linkedBash();
        const result = await bash.exec(command(link));
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(stdout);
        expect(result.exitCode).toBe(0);
      });

      it("writes through the link into the folder it leads to", async () => {
        const { bash, link, target } = await linkedBash();
        const result = await bash.exec(`echo hi > ${link}/new.txt`);
        expect(result.exitCode).toBe(0);
        await expect(
          fs.readFile(path.join(target, "new.txt"), "utf8"),
        ).resolves.toBe("hi\n");
      });

      it("opens nothing else in the closed folder", async () => {
        const { bash, documents, link, target } = await linkedBash();
        await fs.symlink(
          path.join(documents, "secret.txt"),
          path.join(target, "secret.txt"),
        );
        for (const secret of [
          `${shellPath(documents)}/secret.txt`,
          `${link}/secret.txt`,
        ]) {
          const result = await bash.exec(`cat ${secret}`);
          expect(result.stdout).toBe("");
          expect(result.exitCode).not.toBe(0);
        }
      });
    },
  );
});

describe("buildBashFs skills mount", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-skills-fs-test-`),
    );
    await fs.mkdir(path.join(tmpDir, "task"));
    await fs.mkdir(path.join(tmpDir, SKILLS_FOLDER_NAME, "existing"), {
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
      userDataDir: AbsolutePathSchema.parse(machine),
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
        path.join(tmpDir, SKILLS_FOLDER_NAME, "made-up", "SKILL.md"),
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
    beginSetupChangeTracking(turn);

    await withTurnContext(turn, () =>
      bash.exec(
        `mkdir -p ${WORKSPACE_SKILLS()}/tracked && echo body > ${WORKSPACE_SKILLS()}/tracked/SKILL.md`,
      ),
    );

    await expect(consumeSetupChanges(turn)).resolves.toEqual([
      { change: "added", kind: "skill", name: "tracked" },
    ]);
  });

  it("provisions the mount when the workspace has no skills dir yet", async () => {
    await fs.rm(path.join(tmpDir, SKILLS_FOLDER_NAME), {
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
        path.join(tmpDir, SKILLS_FOLDER_NAME, "first", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toBe("body\n");
  });

  it("leaves skills and apps for the first one to make inside a granted workspace folder", async () => {
    await fs.rm(path.join(tmpDir, SKILLS_FOLDER_NAME), {
      force: true,
      recursive: true,
    });
    const layout = buildWorkspaceFsLayout({
      apps: true,
      chatHostRoot: WorkDirSchema.parse(path.join(tmpDir, "task")),
      folders: {
        workspace: {
          access: "read-write",
          id: MountedFolder.IdSchema.parse("workspace-id"),
          path: AbsolutePathSchema.parse(tmpDir),
        },
      },
    });
    const bash = new Bash({
      cwd: layout.chat.shellRoot,
      fs: await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 }),
    });
    expect(existsSync(getWorkspaceSkillsDir())).toBe(false);
    expect(existsSync(getWorkspaceConfig().appsDir)).toBe(false);

    const written = await bash.exec(
      `mkdir -p ${WORKSPACE_SKILLS()}/first && echo body > ${WORKSPACE_SKILLS()}/first/SKILL.md`,
    );
    expect(written.exitCode).toBe(0);
    await expect(
      fs.readFile(
        path.join(tmpDir, SKILLS_FOLDER_NAME, "first", "SKILL.md"),
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
      userDataDir: AbsolutePathSchema.parse(path.join(tmpDir, "machine")),
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
        dangerouslyAllowEveryFolder: false,
      },
    });
  }

  it("asks for the folder one level into the place, as a mount's refusal does", () => {
    const refusal = outsideFolderRefusal(
      layoutWith("ask"),
      path.join(drives, "Backup", "photos", "2026", "new.jpg"),
      "write",
    );
    expect(refusal).toContain(
      `ask for "${drives}/Backup" with ask_permission.`,
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
  });

  // The shell remembers a program it found on the PATH by its path, and
  // looks there first the next time it runs (on Windows, where nothing
  // outside a mount is read, `ssh-add; ssh-add` asked for
  // /c/WINDOWS/System32/OpenSSH).
  it("asks nothing for a look at a program the shell found on the PATH", async () => {
    const program = path.join(drives, "Backup", "bin", "tool");
    await fs.mkdir(path.dirname(program));
    await fs.writeFile(program, "");
    const layout = layoutWith("ask");
    expect(outsideFolderRefusal(layout, program, "read")).toContain(
      "needs the person's yes",
    );
    noteFoundProgram(program);
    expect(outsideFolderRefusal(layout, program, "read")).toBeUndefined();
    expect(outsideFolderRefusal(layout, program, "write")).toContain(
      "needs the person's yes",
    );
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

  it.each([
    ["C:\\Users\\sam\\notes.md", "/c/Users/sam/notes.md"],
    ["C:/Users/sam/notes.md", "/c/Users/sam/notes.md"],
    ["C:\\Users\\sam\\..\\dev\\notes.md", "/c/Users/dev/notes.md"],
    ["\\\\?\\C:\\Users\\sam\\notes.md", "/c/Users/sam/notes.md"],
    ["\\\\.\\C:\\Users\\sam", "/c/Users/sam"],
    ["\\\\nas\\media\\a.mp4", "//nas/media/a.mp4"],
    ["\\\\?\\UNC\\nas\\media\\a.mp4", "//nas/media/a.mp4"],
  ])("reads the host's own %s as %s", (arg, spelled) => {
    expect(
      shellPathOfHostSpelling(arg, { hostCwd: "C:\\chats\\c1\\work" }),
    ).toBe(spelled);
  });

  it.each([
    "NEEDLE",
    String.raw`\d+\s`,
    String.raw`\Users\sam`,
    "C:relative",
    "/c/Users/sam",
    "./notes.md",
    "-i",
    "",
  ])("leaves %s for the shell to resolve", (arg) => {
    expect(
      shellPathOfHostSpelling(arg, { hostCwd: "C:\\chats\\c1\\work" }),
    ).toBeNull();
  });

  it("reads no spelling as the host's own off Windows", () => {
    expect(
      shellPathOfHostSpelling("C:\\Users\\sam\\notes.md", {
        hostCwd: "/chats/c1/work",
        platform: "darwin",
      }),
    ).toBeNull();
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
