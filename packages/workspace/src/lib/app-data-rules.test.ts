import { execa } from "execa";
import { Bash } from "just-bash";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import {
  type NativeReach,
  bwrapArgs,
  bwrapAvailable,
  refusalNote,
  refusedPathIn,
  seatbeltAvailable,
  seatbeltProfile,
  withNativeReach,
  wrapNativeCommand,
} from "./native-sandbox";
import { RG_DISK_PATH } from "./ripgrep";
import { createDuCommand } from "./shell-commands/du";
import { execShim } from "./shell-commands/exec-shim";
import { withAppDataLeftOut } from "./shell-commands/rg";
import { workspaceLayout } from "./workspace-layout";
import { raiseAsk } from "./permissions/asks";
import { nativeReachFor } from "./permissions/chat-rules";
import { ruleRefusal } from "./permissions/rules-fs";
import { reachOf, type Rules, rulesFor } from "./permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { toolFs } from "./tool-fs";
import { buildBashFs, buildWorkspaceFsLayout } from "./workspace-fs-layout";

vi.mock("./permissions/asks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./permissions/asks")>()),
  raiseAsk: vi.fn(),
}));

/**
 * The app's own data, laid out as on a person's computer: this computer's
 * folder where Linux and macOS keep other apps' data, the runtime folder in
 * it, the workspace kept there or in a folder the person picked in their
 * Documents, and one chat's records and work beside another's. Inside it
 * everything is refused, plainly and with no card, whatever the person
 * allowed around it, but for what the app opens. The top level of a picked
 * folder is the person's, and follows their rules like any folder.
 */
const SHAPES = [
  { appFiles: ".config", name: "where Linux keeps it" },
  {
    appFiles: path.join("Library", "Application Support"),
    name: "where macOS keeps it",
  },
  {
    appFiles: path.join("Library", "Application Support"),
    name: "with the workspace in a folder the person picked",
    workspace: path.join("Documents", "Instrument"),
  },
];

const settings = { apps: [], folders: [], places: {}, withoutAsking: false };
const previous = getWorkspaceConfig();
const sessionId = StoreId.newSessionId();
const homes: string[] = [];

afterAll(() => {
  setWorkspaceConfig(previous);
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

beforeEach(() => {
  vi.mocked(raiseAsk).mockClear();
});

/**
 * A home with the app's data laid down where `appFiles` says, and the
 * workspace in it or at `workspaceIn`, below the home folder.
 */
function homeShaped(appFiles: string, workspaceIn?: string) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "app-data-")));
  homes.push(home);
  const machine = path.join(home, appFiles, "Instrument");
  const workspaceMachine = path.join(machine, "workspaces-data", "default");
  const workspace =
    workspaceIn === undefined
      ? path.join(machine, "workspace")
      : path.join(home, workspaceIn);
  const data = workspaceLayout(workspace);
  const paths = {
    appFiles: path.join(home, appFiles),
    home,
    machine,
    data,
    otherRecord: path.join(data.chatsDir, "2026-10-13-other"),
    otherWork: path.join(workspaceMachine, "work", "2026-10-13-other"),
    record: path.join(data.chatsDir, "2026-10-13-chat"),
    runtime: path.join(machine, "runtime"),
    work: path.join(workspaceMachine, "work", "2026-10-13-chat"),
    workspace,
    workspaceMachine,
  };
  for (const file of [
    `${paths.work}/notes.md`,
    `${paths.record}/attachments/a.pdf`,
    `${paths.record}/chat.db`,
    `${paths.record}/settings.json`,
    `${paths.otherRecord}/chat.db`,
    `${paths.otherRecord}/attachments/a.pdf`,
    `${paths.otherWork}/notes.md`,
    `${workspace}/.instrument/workspace.json`,
    `${workspace}/.instrument/preferences.json`,
    `${data.skillsDir}/mine/SKILL.md`,
    `${data.appsDir}/linear/app.json`,
    `${workspaceMachine}/keys/x`,
    `${workspaceMachine}/browser/Cookies`,
    `${workspaceMachine}/permissions.json`,
    `${machine}/Cookies`,
    `${machine}/Local State`,
    `${machine}/logs/main.log`,
    `${machine}/workspaces.json`,
    `${paths.runtime}/caches/uv/x`,
    `${paths.runtime}/config/npmrc`,
    `${paths.runtime}/python/bin/python3`,
    `${paths.runtime}/skills/pdf/SKILL.md`,
    `${paths.runtime}/environments/abc/x`,
    `${paths.runtime}/preload/tools-preload.mjs`,
    `${paths.runtime}/build/caches/uv/x`,
    `${paths.runtime}/build/config/npmrc`,
    `${paths.runtime}/bin/node`,
    `${paths.appFiles}/Other/state.json`,
    `${workspace}/report.pdf`,
  ]) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "secret");
  }
  // Links of the kind the agent can make wherever it writes, named far
  // deeper than what they lead to: one into the keys, one to the folder
  // holding the app's data.
  const deep = path.join(home, "Downloads", ..."abcdefghijk".split(""));
  mkdirSync(deep, { recursive: true });
  const deepLinks = {
    appFiles: path.join(deep, "app-files"),
    keys: path.join(deep, "keys"),
  };
  symlinkSync(path.join(workspaceMachine, "keys"), deepLinks.keys);
  symlinkSync(paths.appFiles, deepLinks.appFiles);
  return { ...paths, deepLinks };
}

type Paths = ReturnType<typeof homeShaped>;

/** The workspace config for the app laid down in `paths`. */
function useApp(paths: Paths) {
  setWorkspaceConfig({
    ...previous,
    appsDir: AbsolutePathSchema.parse(paths.data.appsDir),
    chatsDir: AbsolutePathSchema.parse(paths.data.chatsDir),
    machineDir: AbsolutePathSchema.parse(paths.machine),
    rootDir: WorkspaceDirSchema.parse(paths.workspace),
    runtimeDir: AbsolutePathSchema.parse(paths.runtime),
    tempFolders: [],
    workFoldersDir: AbsolutePathSchema.parse(
      path.join(paths.workspaceMachine, "work"),
    ),
    workspaceMachineDir: AbsolutePathSchema.parse(paths.workspaceMachine),
  });
}

/** The chat's layout under the person's rules, its home folder reached. */
function layoutUnder(
  paths: Paths,
  {
    grants = [],
    opened = [],
    withoutAsking = false,
  }: {
    /** Folders the chat was allowed by a card. */
    grants?: string[];
    /** Folders Settings › Permissions allows. */
    opened?: string[];
    withoutAsking?: boolean;
  },
) {
  const rules: Rules = {
    ...rulesFor({
      grants: grants.map((grant) => ({
        grantedAt: new Date(0),
        path: AbsolutePathSchema.parse(grant),
        source: "card" as const,
      })),
      home: paths.home,
      settings: {
        ...settings,
        folders: opened.map((folder) => ({
          addedAt: new Date(0),
          level: "allow" as const,
          path: AbsolutePathSchema.parse(folder),
        })),
        withoutAsking,
      },
    }),
    asker: { chatId: ChatIdSchema.parse("2026-10-13-chat"), sessionId },
  };
  return buildWorkspaceFsLayout({
    apps: true,
    chatHostRoot: WorkDirSchema.parse(paths.work),
    folders: {
      [paths.home]: {
        access: "read-only",
        id: MountedFolder.IdSchema.parse("home"),
        path: AbsolutePathSchema.parse(paths.home),
      },
    },
    recordHostRoot: ChatDirSchema.parse(paths.record),
    rules,
  });
}

/** What the person could allow around the app's data, by a card or in Settings. */
function personRules(paths: Paths) {
  return [
    { name: "no rule of the person's" },
    {
      grants: [path.join(paths.home, ".config")],
      name: "a card's yes to ~/.config",
    },
    {
      grants: [path.join(paths.home, "Library", "Application Support")],
      name: "a card's yes to ~/Library/Application Support",
    },
    { grants: [paths.home], name: "a card's yes to the home folder" },
    {
      name: "Settings allowing the disk",
      opened: [path.parse(paths.home).root],
    },
    {
      name: "Settings allowing its keys",
      opened: [path.join(paths.workspaceMachine, "keys")],
    },
    { name: "folders used without asking", withoutAsking: true },
    {
      name: "Settings allowing a link deep in Downloads that leads to its keys",
      opened: [paths.deepLinks.keys],
    },
    {
      grants: [paths.deepLinks.appFiles],
      name: "a card's yes to a link deep in Downloads that leads to the folder holding it",
    },
  ];
}

/** What the agent may do in and around the app's data, whatever the person allowed. */
function reachTable(p: Paths) {
  return [
    ["its own work folder", "read", `${p.work}/notes.md`, "allow"],
    ["its own work folder", "write", `${p.work}/notes.md`, "allow"],
    ["what it was sent", "read", `${p.record}/attachments/a.pdf`, "allow"],
    ["what it was sent", "write", `${p.record}/attachments/a.pdf`, "never"],
    ["its handoff notes", "write", `${p.record}/handoff-notes.md`, "allow"],
    ["its own chat.db", "read", `${p.record}/chat.db`, "never"],
    ["its own settings.json", "read", `${p.record}/settings.json`, "never"],
    ["another chat's records", "read", `${p.otherRecord}/chat.db`, "never"],
    [
      "what another chat was sent",
      "read",
      `${p.otherRecord}/attachments/a.pdf`,
      "never",
    ],
    ["another chat's work folder", "read", `${p.otherWork}/notes.md`, "never"],
    ["another chat's work folder", "write", `${p.otherWork}/notes.md`, "never"],
    [
      "the workspace's identity",
      "read",
      `${p.workspace}/.instrument/workspace.json`,
      "never",
    ],
    [
      "the person's preferences",
      "read",
      `${p.workspace}/.instrument/preferences.json`,
      "never",
    ],
    ["the keys", "read", `${p.workspaceMachine}/keys/x`, "never"],
    [
      "the browser data",
      "read",
      `${p.workspaceMachine}/browser/Cookies`,
      "never",
    ],
    [
      "the folder rules",
      "read",
      `${p.workspaceMachine}/permissions.json`,
      "never",
    ],
    ["the app's own cookies", "read", `${p.machine}/Cookies`, "never"],
    [
      "the app's own Chromium state",
      "read",
      `${p.machine}/Local State`,
      "never",
    ],
    ["the app's own log", "read", `${p.machine}/logs/main.log`, "never"],
    [
      "the registry of workspaces",
      "read",
      `${p.machine}/workspaces.json`,
      "never",
    ],
    [
      "the registry of workspaces",
      "write",
      `${p.machine}/workspaces.json`,
      "never",
    ],
    [
      "the workspace's skills",
      "write",
      `${p.data.skillsDir}/mine/SKILL.md`,
      "allow",
    ],
    [
      "the workspace's apps",
      "write",
      `${p.data.appsDir}/linear/app.json`,
      "allow",
    ],
    ["the runtime's caches", "write", `${p.runtime}/caches/uv/x`, "allow"],
    ["the runtime's config", "write", `${p.runtime}/config/npmrc`, "allow"],
    ["the managed Python", "read", `${p.runtime}/python/bin/python3`, "allow"],
    ["the managed Python", "write", `${p.runtime}/python/probe`, "never"],
    [
      "the skills the app ships",
      "read",
      `${p.runtime}/skills/pdf/SKILL.md`,
      "allow",
    ],
    ["the skills the app ships", "write", `${p.runtime}/skills/probe`, "never"],
    [
      "a skill's environment",
      "read",
      `${p.runtime}/environments/abc/x`,
      "allow",
    ],
    [
      "a skill's environment",
      "write",
      `${p.runtime}/environments/probe`,
      "never",
    ],
    ["the bin links", "read", `${p.runtime}/bin/node`, "allow"],
    ["the bin links", "write", `${p.runtime}/bin/x`, "never"],
    ["the preload", "read", `${p.runtime}/preload/tools-preload.mjs`, "allow"],
    ["the preload", "write", `${p.runtime}/preload/tools-preload.mjs`, "never"],
    ["the build caches", "read", `${p.runtime}/build/caches/uv/x`, "never"],
    ["the build caches", "write", `${p.runtime}/build/caches/uv/x`, "never"],
    ["the build config", "read", `${p.runtime}/build/config/npmrc`, "never"],
    ["the build config", "write", `${p.runtime}/build/config/npmrc`, "never"],
    [
      "bubblewrap's stand-in for a closed file",
      "read",
      `${p.runtime}/sandbox/closed-file`,
      "never",
    ],
  ] as const;
}

describe.each(SHAPES)("the app's data $name", (shape) => {
  const paths = homeShaped(shape.appFiles, shape.workspace);
  // Set as the cases are collected, since each builds its layout from the
  // config then, and again before each runs.
  useApp(paths);
  beforeEach(() => {
    useApp(paths);
  });

  describe.each(personRules(paths))("under $name", (person) => {
    const layout = layoutUnder(paths, person);

    it.each(reachTable(paths))(
      "%s: %s %s is %s",
      (_name, op, hostPath, level) => {
        expect(reachOf(layout.rules, hostPath, op).level).toBe(level);
      },
    );

    // The picked folder is `Instrument` in Documents, the output folder's
    // place, so its top level takes that place's rule rather than the app's.
    it.runIf(shape.workspace !== undefined).each(["read", "write"] as const)(
      "opens finished work at the workspace's top level, the output folder, to %s",
      (op) => {
        expect(
          reachOf(layout.rules, `${paths.workspace}/report.pdf`, op).level,
        ).toBe("allow");
      },
    );

    it.each(reachTable(paths).filter(([, , , level]) => level === "never"))(
      "refuses %s plainly, with no card",
      (_name, op, hostPath) => {
        const refusal = ruleRefusal({
          hostPath,
          op,
          rules: layout.rules,
          spell: (spelled) => spelled,
        });
        expect(refusal).toMatch(
          /is Instrument's own data, which no command reads or changes|is read-only/,
        );
        expect(raiseAsk).not.toHaveBeenCalled();
      },
    );
  });

  describe("the file tools and the shell", () => {
    const layout = layoutUnder(paths, { grants: [paths.appFiles] });

    it.each([
      ["the keys", `${paths.workspaceMachine}/keys/x`],
      ["the registry of workspaces", `${paths.machine}/workspaces.json`],
      ["another chat's work folder", `${paths.otherWork}/notes.md`],
      ["another chat's settings", `${paths.otherRecord}/settings.json`],
      ["its own chat.db", `${paths.record}/chat.db`],
    ])(
      "refuse %s to a file tool's read, rather than finding it missing",
      async (_name, target) => {
        const files = await toolFs(layout);
        const read = await files.fs
          .readFileBuffer(target)
          .then(() => "read", (error: unknown) => files.failure(error, target));
        expect(typeof read !== "string" && read.error.message).toBe(
          `${JSON.stringify(target)} is Instrument's own data, which no command reads or changes; don't look for another way in. Your work folder ($INSTRUMENT_WORK) and the files the person sent ($INSTRUMENT_ATTACHMENTS) stay open to you.`,
        );
      },
    );

    it.skipIf(process.platform === "win32")(
      "refuses a listing, a read and a write in the shell, saying it is not allowed",
      async () => {
        const bash = new Bash({
          cwd: layout.chat.shellRoot,
          fs: await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 }),
        });
        const result = await bash.exec(
          [
            `ls '${paths.otherWork}'`,
            `cat '${paths.workspaceMachine}/keys/x'`,
            `cat '${paths.machine}/workspaces.json'`,
            `ls '${paths.machine}'`,
            `echo x > '${paths.machine}/Cookies'`,
            `echo x > '${paths.runtime}/bin/probe'`,
            `echo x > '${paths.runtime}/python/probe'`,
            `echo x > '${paths.runtime}/preload/probe'`,
            `echo x > '${paths.runtime}/build/caches/probe'`,
          ].join("; "),
        );
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Permission denied");
        expect(result.stderr).not.toContain("No such file or directory");
        expect(raiseAsk).not.toHaveBeenCalled();
        for (const probe of [
          "bin/probe",
          "preload/probe",
          "build/caches/probe",
        ]) {
          expect(() => realpathSync(path.join(paths.runtime, probe))).toThrow();
        }
      },
    );
  });

  describe("a card for something beside the app's own data", () => {
    const layout = layoutUnder(paths, {});

    it("names the folder beside it, never the one that holds it", () => {
      ruleRefusal({
        hostPath: `${paths.appFiles}/Other/state.json`,
        op: "read",
        rules: layout.rules,
        spell: (spelled) => spelled,
      });
      expect(vi.mocked(raiseAsk).mock.calls).toEqual([
        [expect.anything(), "folder", path.join(paths.appFiles, "Other")],
      ]);
    });

    it("raises none for the folder that holds it", () => {
      expect(
        ruleRefusal({
          hostPath: paths.appFiles,
          isDirectory: true,
          op: "read",
          rules: layout.rules,
          spell: (spelled) => spelled,
        }),
      ).toBe(
        `${JSON.stringify(paths.appFiles)} is in ${JSON.stringify(paths.appFiles)}, which holds Instrument's own data, so no card can open it whole. Work in this conversation's folder, or a folder the person names.`,
      );
      expect(raiseAsk).not.toHaveBeenCalled();
    });
  });

  describe.runIf(seatbeltAvailable())("a native command on this Mac", () => {
    const layout = layoutUnder(paths, { grants: [paths.appFiles] });
    const reach = nativeReachFor(layout.rules, layout);

    it.each([
      ["reads its own work folder", `cat '${paths.work}/notes.md'`, 0],
      ["writes its own work folder", `echo x > '${paths.work}/new.md'`, 0],
      [
        "reads the managed Python",
        `cat '${paths.runtime}/python/bin/python3'`,
        0,
      ],
      [
        "writes the runtime's caches",
        `echo x > '${paths.runtime}/caches/uv/y'`,
        0,
      ],
      ["refuses the keys", `cat '${paths.workspaceMachine}/keys/x'`, 1],
      [
        "refuses another chat's work folder",
        `cat '${paths.otherWork}/notes.md'`,
        1,
      ],
      [
        "refuses a listing of the work folders",
        `ls '${paths.workspaceMachine}/work'`,
        1,
      ],
      [
        "refuses another chat's records",
        `cat '${paths.otherRecord}/chat.db'`,
        1,
      ],
      ["refuses the app's own cookies", `cat '${paths.machine}/Cookies'`, 1],
      [
        "refuses a change to the registry of workspaces",
        `echo x > '${paths.machine}/workspaces.json'`,
        1,
      ],
      [
        "refuses a change to the managed Python",
        `echo x > '${paths.runtime}/python/probe'`,
        1,
      ],
      [
        "reads the preload",
        `cat '${paths.runtime}/preload/tools-preload.mjs'`,
        0,
      ],
      [
        "refuses a change to the preload",
        `echo x > '${paths.runtime}/preload/tools-preload.mjs'`,
        1,
      ],
      [
        "refuses a file beside the preload",
        `echo x > '${paths.runtime}/preload/probe'`,
        1,
      ],
      [
        "refuses the build caches",
        `cat '${paths.runtime}/build/caches/uv/x'`,
        1,
      ],
      [
        "refuses a change to the build caches",
        `echo x > '${paths.runtime}/build/caches/uv/x'`,
        1,
      ],
      [
        "refuses a change to the build config",
        `echo x > '${paths.runtime}/build/config/npmrc'`,
        1,
      ],
      [
        "reads beside it, where the card opened",
        `cat '${paths.appFiles}/Other/state.json'`,
        0,
      ],
    ])("%s", async (_name, script, exitCode) => {
      const spawned = wrapNativeCommand("/bin/sh", ["-c", script], reach);
      const result = await execa(spawned.file, spawned.args, {
        reject: false,
      });
      expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
    });

    // A script that catches the refusal and prints it exits 0, and is told
    // why all the same where the path is the app's own.
    it.each([
      [
        "says why when stderr names the app's own data",
        `cat '${paths.otherWork}/notes.md' || true`,
        true,
      ],
      [
        "leaves the same line on stdout alone",
        `cat '${paths.otherWork}/notes.md' 2>&1 || true`,
        false,
      ],
      [
        "leaves a refusal outside the app's own data alone",
        `echo x > '${paths.runtime}/python/probe' || true`,
        false,
      ],
    ])("a command that exits 0 %s", async (_name, script, noted) => {
      const result = await withNativeReach(reach, () =>
        execShim("/bin/sh", ["-c", script], { cwd: paths.work }),
      );
      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        "Operation not permitted",
      );
      expect(result.stderr.includes("Instrument's own data")).toBe(noted);
      expect(raiseAsk).not.toHaveBeenCalled();
    });
  });

  // A rule named deep through a link holds what it leads to only as deep
  // as that really is, so the deeper rule closing the app's data still
  // decides there, and one leading into that data opens nothing.
  describe("a person's rule named deep through a link", () => {
    const layout = layoutUnder(paths, {
      grants: [paths.deepLinks.appFiles],
      opened: [paths.deepLinks.keys],
    });
    const reach = nativeReachFor(layout.rules, layout);
    const keysThroughFolder = path.join(
      paths.deepLinks.appFiles,
      path.relative(paths.appFiles, paths.workspaceMachine),
      "keys",
      "x",
    );

    it("is dropped where it leads into the app's data", () => {
      expect(
        layout.rules.rules.some((rule) => rule.path === paths.deepLinks.keys),
      ).toBe(false);
    });

    it("orders the Seatbelt profile by where each spelling really is", () => {
      const lines = seatbeltProfile(reach).split("\n");
      const opened = lines.indexOf(
        `(allow file-read* file-write* network-outbound (subpath "${paths.appFiles}"))`,
      );
      expect(opened).not.toBe(-1);
      expect(opened).toBeLessThan(
        lines.indexOf(
          `(deny file-read* file-write* network-outbound (subpath "${paths.machine}"))`,
        ),
      );
    });

    it("binds what it leads to before the app's data is closed", () => {
      const args = bwrapArgs(reach).join(" ");
      const opened = args.indexOf(`--bind ${paths.appFiles} ${paths.appFiles}`);
      expect(opened).not.toBe(-1);
      expect(opened).toBeLessThan(args.indexOf(`--tmpfs ${paths.machine}`));
      expect(args).not.toContain(
        `--bind ${path.join(paths.workspaceMachine, "keys")}`,
      );
    });

    it.runIf(seatbeltAvailable()).each([
      [
        "refuses the keys through the link to them",
        `cat '${paths.deepLinks.keys}/x'`,
        1,
      ],
      [
        "refuses the keys by their own path",
        `cat '${paths.workspaceMachine}/keys/x'`,
        1,
      ],
      [
        "refuses a change to the keys through the link",
        `echo x > '${paths.deepLinks.keys}/probe'`,
        1,
      ],
      [
        "refuses the keys through the link to the folder holding them",
        `cat '${keysThroughFolder}'`,
        1,
      ],
      [
        "reads beside them, where the card opened",
        `cat '${paths.deepLinks.appFiles}/Other/state.json'`,
        0,
      ],
    ])("%s", async (_name, script, exitCode) => {
      const spawned = wrapNativeCommand("/bin/sh", ["-c", script], reach);
      const result = await execa(spawned.file, spawned.args, {
        reject: false,
      });
      expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
    });
  });

  // `du` walks as the app, and `rg` on Windows has no sandbox to refuse it
  // the app's data, so each leaves it out itself: what the rules close is
  // neither listed nor counted, and what opens inside it is walked.
  describe("a walk with nothing else to hold it", () => {
    const layout = layoutUnder(paths, {});
    // The files the table names that are there, each with whether the
    // rules let the agent read it.
    const files = reachTable(paths).flatMap(([, op, hostPath, level]) =>
      op === "read" && existsSync(hostPath)
        ? [{ hostPath, open: level === "allow" }]
        : [],
    );
    // Each file the table names under `root` that the walk got wrong: one
    // it walked that the rules close, or one it left out that they open.
    const walkedWrong = (walked: readonly string[], root: string) => {
      const under = files.filter(
        ({ hostPath }) =>
          path.relative(root, hostPath).split(path.sep)[0] !== "..",
      );
      return under.length === 0
        ? [`nothing the table names is under ${root}`]
        : under
            .filter(({ hostPath, open }) => walked.includes(hostPath) !== open)
            .map(
              ({ hostPath, open }) =>
                `${open ? "left out" : "walked"} ${hostPath}`,
            );
    };

    it.each([
      ["the home folder", ["-uuu", "--files", paths.home], paths.work],
      [
        "the home folder, past a glob of the agent's",
        ["-uuu", "--files", "-g", "*", "--iglob", "*.db", paths.home],
        paths.work,
      ],
      [
        "the home folder after --",
        ["-uuu", "--files", "--", paths.home],
        paths.work,
      ],
      [
        "the home folder by a step up",
        ["-uuu", "--files", ".."],
        path.join(paths.home, "Downloads"),
      ],
      [
        "the home folder spelled with a step in place",
        ["-uuu", "--files", "./../"],
        path.join(paths.home, "Downloads"),
      ],
      ["the workspace", ["-uuu", "--files", paths.workspace], paths.work],
      ["the workspace it was cd'd into", ["-uuu", "--files"], paths.workspace],
      ["the workspace as .", ["-uuu", "--files", "."], paths.workspace],
    ])("rg leaves it out of %s", async (_name, args, cwd) => {
      const searched = withAppDataLeftOut(args, layout, cwd);
      if ("error" in searched) {
        throw new Error(searched.error);
      }
      const listed = await execa(
        RG_DISK_PATH,
        ["--no-config", "--path-separator=/", ...searched.args],
        { cwd, reject: false },
      );
      const walked = listed.stdout
        .split("\n")
        .filter(Boolean)
        .map((printed) => path.resolve(cwd, printed));
      const root = path.resolve(
        cwd,
        args.at(-1)?.startsWith("-") ? "." : (args.at(-1) ?? "."),
      );
      expect(walkedWrong(walked, root)).toEqual([]);
    });

    // Held by the sandbox, ripgrep can pass through a closed folder but not
    // list it, so a walk takes no way on through one: each is left out
    // whole, and the search ends without an error.
    it.runIf(
      shape.workspace !== undefined && (seatbeltAvailable() || bwrapAvailable()),
    ).each([
      ["the workspace", ["-uuu", "--files", paths.workspace], paths.work],
      ["the workspace it was cd'd into", ["-uuu", "--files"], paths.workspace],
    ])(
      "rg held by the sandbox walks %s with no error",
      async (_name, args, cwd) => {
        const searched = withAppDataLeftOut(args, layout, cwd, {
          sandboxed: true,
        });
        if ("error" in searched) {
          throw new Error(searched.error);
        }
        const spawned = wrapNativeCommand(
          RG_DISK_PATH,
          ["--no-config", "--path-separator=/", ...searched.args],
          nativeReachFor(layout.rules, layout),
        );
        const listed = await execa(spawned.file, spawned.args, {
          cwd,
          reject: false,
        });
        expect(listed.stderr).toBe("");
        expect(listed.exitCode).toBe(0);
        const walked = new Set(
          listed.stdout
            .split("\n")
            .filter(Boolean)
            .map((printed) => path.resolve(cwd, printed)),
        );
        expect(
          files.filter(({ hostPath, open }) => !open && walked.has(hostPath)),
        ).toEqual([]);
      },
    );

    it.skipIf(process.platform === "win32")(
      "du leaves it out of the home folder",
      async () => {
        const bash = new Bash({
          customCommands: [createDuCommand({ layout })],
          cwd: layout.chat.shellRoot,
          fs: await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 }),
        });
        const result = await bash.exec(`du -a '${paths.home}'`);
        const walked = result.stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => line.slice(line.indexOf("\t") + 1));
        expect(walkedWrong(walked, paths.home)).toEqual([]);
      },
    );
  });

  describe("bubblewrap's arguments", () => {
    const layout = layoutUnder(paths, { grants: [paths.appFiles] });
    const reach = nativeReachFor(layout.rules, layout);
    const args = bwrapArgs(reach).join(" ");

    it("closes this computer's folder, passing through to what opens in it", () => {
      expect(args).toContain(`--perms 0111 --tmpfs ${paths.machine}`);
      expect(args).toContain(`--bind ${paths.work} ${paths.work}`);
      expect(args).toContain(
        `--ro-bind ${paths.runtime}/python ${paths.runtime}/python`,
      );
      expect(args).not.toContain(`--bind ${paths.otherWork}`);
    });

    it.each([
      ["the work folders", path.join(paths.workspaceMachine, "work")],
      ["the chats' records", paths.data.chatsDir],
      ["its own record folder", paths.record],
    ])(
      "makes %s, on the way to what opens, searchable and no more",
      (_name, folder) => {
        expect(`${args} `).toContain(`--perms 0111 --dir ${folder} `);
      },
    );

    // An empty folder answers a name in it as missing, and the note says
    // why; nothing is listed to stand in for what the folder holds.
    it.each([
      ["another chat's work folder", paths.otherWork],
      ["another chat's records", paths.otherRecord],
      ["the keys", path.join(paths.workspaceMachine, "keys")],
      [
        "the registry of workspaces",
        path.join(paths.machine, "workspaces.json"),
      ],
    ])("names nothing of %s", (_name, target) => {
      expect(args).not.toContain(target);
    });

    it("keeps the same arguments with 2,000 chats as with 2", () => {
      const fresh = homeShaped(shape.appFiles, shape.workspace);
      useApp(fresh);
      const argsFor = (person: Parameters<typeof layoutUnder>[1]) => {
        const under = layoutUnder(fresh, person);
        return bwrapArgs(nativeReachFor(under.rules, under));
      };
      const people = [{}, { grants: [fresh.appFiles] }];
      const two = people.map(argsFor);
      for (let i = 0; i < 1998; i++) {
        const id = `2026-10-14-chat-${String(i).padStart(4, "0")}`;
        mkdirSync(path.join(fresh.data.chatsDir, id, "attachments"), {
          recursive: true,
        });
        writeFileSync(path.join(fresh.data.chatsDir, id, "chat.db"), "");
        mkdirSync(path.join(fresh.workspaceMachine, "work", id));
        writeFileSync(
          path.join(fresh.workspaceMachine, "work", id, "a.md"),
          "",
        );
      }
      const many = people.map(argsFor);
      expect(many.map((each) => each.length)).toEqual(
        two.map((each) => each.length),
      );
      expect(many).toEqual(two);
    });

    it.each([
      [
        "Python's missing file",
        `FileNotFoundError: [Errno 2] No such file or directory: '${paths.machine}/workspaces.json'`,
      ],
      [
        "Node's missing file",
        `Error: ENOENT: no such file or directory, open '${paths.otherWork}/notes.md'`,
      ],
      [
        "cat's missing file",
        `cat: ${paths.otherRecord}/chat.db: No such file or directory`,
      ],
      [
        "Node's refused listing",
        `Error: EACCES: permission denied, scandir '${paths.workspaceMachine}/work'`,
      ],
    ])(
      "tells the agent %s there is the app's own, whatever the exit",
      (_name, line) => {
        for (const appDataOnly of [false, true]) {
          const refused = refusedPathIn(
            line,
            reach satisfies NativeReach,
            paths.work,
            { appDataOnly },
          );
          expect(refused && refusalNote(refused)).toContain(
            "is Instrument's own data, which no command reads or changes",
          );
        }
      },
    );

    it("says nothing of a missing file outside it on a zero exit", () => {
      expect(
        refusedPathIn(
          `FileNotFoundError: [Errno 2] No such file or directory: '${paths.home}/Documents/a.csv'`,
          reach,
          paths.work,
          { appDataOnly: true },
        ),
      ).toBeUndefined();
    });
  });
});

describe("the app's own data in a temp folder, which a link leads to", () => {
  const spelled = mkdtempSync(path.join(os.tmpdir(), "app-data-linked-"));
  const real = realpathSync(spelled);
  writeFileSync(path.join(spelled, "secret"), "secret");
  const rules: Rules = {
    home: os.homedir(),
    rules: [
      ...[os.tmpdir(), realpathSync(os.tmpdir())].map((temp) => ({
        level: "allow" as const,
        path: temp,
        source: "system" as const,
      })),
      { appData: true, level: "never", path: spelled, source: "system" },
    ],
    withoutAsking: false,
  };

  afterAll(() => {
    rmSync(spelled, { force: true, recursive: true });
  });

  it.each([spelled, real])("stays closed by the path %s", (folder) => {
    expect(reachOf(rules, path.join(folder, "secret"), "read").level).toBe(
      "never",
    );
  });

  it.runIf(seatbeltAvailable())(
    "stays closed to a native command",
    async () => {
      const spawned = wrapNativeCommand(
        "/bin/cat",
        [path.join(spelled, "secret")],
        { readOnly: [], readWrite: [], rules },
      );
      const result = await execa(spawned.file, spawned.args, {
        reject: false,
      });
      expect(result.exitCode).not.toBe(0);
    },
  );
});
