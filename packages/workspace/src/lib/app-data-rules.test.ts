import { execa } from "execa";
import { Bash } from "just-bash";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { MEMORY_FOLDER_NAME } from "../constants";
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
  bwrapArgs,
  bwrapAvailable,
  seatbeltAvailable,
  seatbeltProfile,
  withNativeReach,
  launchNative,
  wrapNativeCommand,
} from "./native-sandbox";
import { RG_DISK_PATH } from "./ripgrep";
import { createDuCommand } from "./shell-commands/du";
import { execShim } from "./shell-commands/exec-shim";
import { withAppDataLeftOut } from "./shell-commands/rg";
import { pathIsWithin } from "./path-is-within";
import { homeDataLayout, workspaceLayout } from "./workspace-layout";
import { nativeReachFor } from "./permissions/chat-rules";
import { ruleRefusal } from "./permissions/rules-fs";
import { reachOf, type Rules, rulesFor } from "./permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { toolFs } from "./tool-fs";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  shellPath,
} from "./workspace-fs-layout";

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

const settings = {
  apps: [],
  chats: {},
  topics: {},
  folders: [],
  places: {},
  dangerouslyAllowEveryFolder: false,
};
// Seatbelt and bubblewrap hold native commands on macOS and Linux only, and
// the refusals read out of a command's output are theirs.
const nativeSandboxed = process.platform !== "win32";
const previous = getWorkspaceConfig();
const sessionId = StoreId.newSessionId();
const homes: string[] = [];

afterAll(() => {
  setWorkspaceConfig(previous);
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

/**
 * A home with the app's data laid down where `appFiles` says, and the
 * workspace in it or at `workspaceIn`, below the home folder.
 */
function homeShaped(appFiles: string, workspaceIn?: string) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "app-data-")));
  homes.push(home);
  const userData = path.join(home, appFiles, "Instrument");
  const workspaceMachine = path.join(userData, "machine", "default");
  const workspace =
    workspaceIn === undefined
      ? path.join(userData, "workspace")
      : path.join(home, workspaceIn);
  const data = workspaceLayout(workspace);
  // Every workspace's chats' work, in the home folder, a folder each.
  const homeData = homeDataLayout(home);
  const workFolders = path.join(homeData.workDir, "instrument-abcd");
  const paths = {
    appFiles: path.join(home, appFiles),
    home,
    userData,
    data,
    otherRecord: path.join(data.chatsDir, "2026-10-13-other"),
    homeData: homeData.dataDir,
    otherWork: path.join(workFolders, "2026-10-13-other"),
    /** A chat's work folder in another workspace on this computer. */
    otherWorkspaceWork: path.join(
      homeData.workDir,
      "taxes-wxyz",
      "2026-10-13-chat",
    ),
    /** Where the person picked their workspace, in their home folder. */
    pickedIn: workspaceIn,
    record: path.join(data.chatsDir, "2026-10-13-chat"),
    runtime: path.join(userData, "runtime"),
    work: path.join(workFolders, "2026-10-13-chat"),
    workFolders,
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
    `${paths.otherWorkspaceWork}/notes.md`,
    `${paths.homeData}/other.json`,
    `${workspace}/.instrument/workspace.json`,
    `${workspace}/.instrument/preferences.json`,
    `${data.skillsDir}/mine/SKILL.md`,
    `${workspace}/Skills/mine/SKILL.md`,
    `${data.appsDir}/Linear/APP.md`,
    `${workspace}/.instrument/apps/linear/app.json`,
    `${workspaceMachine}/keys/x`,
    `${workspaceMachine}/browser/Cookies`,
    `${workspaceMachine}/permissions.json`,
    `${userData}/Cookies`,
    `${userData}/Local State`,
    `${userData}/logs/main.log`,
    `${userData}/workspaces.json`,
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
  // holding the app's data. Junctions on Windows, which an account without
  // the symlink privilege can make; elsewhere the type is ignored.
  const deep = path.join(home, "Downloads", ..."abcdefghijk".split(""));
  mkdirSync(deep, { recursive: true });
  const deepLinks = {
    appFiles: path.join(deep, "app-files"),
    keys: path.join(deep, "keys"),
  };
  symlinkSync(path.join(workspaceMachine, "keys"), deepLinks.keys, "junction");
  symlinkSync(paths.appFiles, deepLinks.appFiles, "junction");
  return { ...paths, deepLinks };
}

type Paths = ReturnType<typeof homeShaped>;

/** The workspace config for the app laid down in `paths`. */
function useApp(paths: Paths) {
  setWorkspaceConfig({
    ...previous,
    appsDir: AbsolutePathSchema.parse(paths.data.appsDir),
    chatsDir: AbsolutePathSchema.parse(paths.data.chatsDir),
    userDataDir: AbsolutePathSchema.parse(paths.userData),
    // A folder the person picked is where their finished work goes too,
    // which the app says through the config. Spelled from this account's
    // home, as every path in the config is, so the output place carries it
    // over to the planted home the way it carries every fixed place.
    ...(paths.pickedIn === undefined
      ? {}
      : {
          outputDir: AbsolutePathSchema.parse(
            path.join(os.homedir(), paths.pickedIn),
          ),
        }),
    rootDir: WorkspaceDirSchema.parse(paths.workspace),
    runtimeDir: AbsolutePathSchema.parse(paths.runtime),
    tempFolders: [],
    workFoldersDir: AbsolutePathSchema.parse(paths.workFolders),
    workspaceMachineDir: AbsolutePathSchema.parse(paths.workspaceMachine),
  });
}

/** The chat's layout under the person's rules, its home folder reached. */
function layoutUnder(
  paths: Paths,
  {
    grants = [],
    opened = [],
    dangerouslyAllowEveryFolder = false,
  }: {
    /** Folders the chat was allowed by a card. */
    grants?: string[];
    /** Folders Settings › Permissions allows. */
    opened?: string[];
    dangerouslyAllowEveryFolder?: boolean;
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
        dangerouslyAllowEveryFolder,
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
    { name: "folders used without asking", dangerouslyAllowEveryFolder: true },
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
    // Every chat's records are open to reading, so one chat can find what
    // was said and done in another, and closed to changes.
    ["its own chat.db", "read", `${p.record}/chat.db`, "allow"],
    ["its own chat.db", "write", `${p.record}/chat.db`, "never"],
    ["its own settings.json", "read", `${p.record}/settings.json`, "allow"],
    ["its own settings.json", "write", `${p.record}/settings.json`, "never"],
    ["another chat's records", "read", `${p.otherRecord}/chat.db`, "allow"],
    ["another chat's records", "write", `${p.otherRecord}/chat.db`, "never"],
    [
      "what another chat was sent",
      "read",
      `${p.otherRecord}/attachments/a.pdf`,
      "allow",
    ],
    // Chats share their work as they share everything of the person's.
    ["another chat's work folder", "read", `${p.otherWork}/notes.md`, "allow"],
    ["another chat's work folder", "write", `${p.otherWork}/notes.md`, "allow"],
    [
      "another workspace's work folder",
      "read",
      `${p.otherWorkspaceWork}/notes.md`,
      "allow",
    ],
    [
      "another workspace's work folder",
      "write",
      `${p.otherWorkspaceWork}/notes.md`,
      "allow",
    ],
    [
      "what else the app keeps in the home folder",
      "read",
      `${p.homeData}/other.json`,
      "never",
    ],
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
    ["the app's own cookies", "read", `${p.userData}/Cookies`, "never"],
    [
      "the app's own Chromium state",
      "read",
      `${p.userData}/Local State`,
      "never",
    ],
    ["the app's own log", "read", `${p.userData}/logs/main.log`, "never"],
    [
      "the registry of workspaces",
      "read",
      `${p.userData}/workspaces.json`,
      "never",
    ],
    [
      "the registry of workspaces",
      "write",
      `${p.userData}/workspaces.json`,
      "never",
    ],
    [
      "the workspace's skills",
      "write",
      `${p.workspace}/Skills/mine/SKILL.md`,
      "allow",
    ],
    [
      "where an older build hid the skills",
      "write",
      `${p.data.skillsDir}/mine/SKILL.md`,
      "never",
    ],
    [
      "the workspace's apps",
      "write",
      `${p.data.appsDir}/Linear/APP.md`,
      "allow",
    ],
    [
      "where an older build hid the apps",
      "write",
      `${p.workspace}/.instrument/apps/linear/app.json`,
      "never",
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

/**
 * Everything inside the workspace's `.instrument/` the agent can still reach,
 * each as `<path under the workspace> (read|write)`. Every path there on disk
 * is asked about, and every path a rule names there whether anything has
 * written it yet or not, so a folder opened by a rule nobody listed is caught
 * too.
 */
function reachedInsideAppData(rules: Rules, paths: Paths): string[] {
  const dataDir = paths.data.dataDir;
  const probes = new Set([
    ...readdirSync(dataDir, { recursive: true }).map((entry) =>
      path.join(dataDir, entry.toString()),
    ),
    ...rules.rules
      .map((rule) => rule.path)
      .filter((named) => pathIsWithin(named, dataDir)),
  ]);
  return [...probes]
    .flatMap((probe) =>
      (["read", "write"] as const)
        .filter((op) => reachOf(rules, probe, op).level !== "never")
        .map(
          (op) =>
            `${path.relative(paths.workspace, probe).split(path.sep).join("/")} (${op})`,
        ),
    )
    .toSorted();
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

    // The memories are at that top level too, so the agent reads and corrects
    // them in the folder the person reads them in, with nothing granted.
    it.runIf(shape.workspace !== undefined).each(["read", "write"] as const)(
      "opens the memories at the workspace's top level to %s",
      (op) => {
        expect(
          reachOf(
            layout.rules,
            path.join(paths.workspace, MEMORY_FOLDER_NAME, "no-stevia.md"),
            op,
          ).level,
        ).toBe("allow");
      },
    );

    it.each(reachTable(paths).filter(([, , , level]) => level === "never"))(
      "refuses %s plainly, naming nothing to ask for",
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
        expect(refusal).not.toContain("ask_permission");
      },
    );
  });

  // F4 asks for `.instrument/` closed to the agent with no exceptions. This
  // is the list of exceptions, so the day both go the expectation is empty
  // and nothing else has crept in beside them.
  describe("what the rules still open inside the app's own data", () => {
    const layout = layoutUnder(paths, {});

    it("is every chat's records to read, and the chat's own two things", () => {
      const dataDir = workspaceLayout(paths.workspace).dataDir;
      const open = layout.rules.rules
        .filter(
          (rule) => rule.level !== "never" && pathIsWithin(rule.path, dataDir),
        )
        .map(
          (rule) =>
            `${path.relative(paths.workspace, rule.path)} (${rule.level})`,
        )
        .toSorted();

      expect(open).toEqual([
        // Every chat's records, read where one chat looks for what was said
        // and done in another.
        path.join(".instrument", "chats") + " (readOnly)",
        // Read where a chat whose move into its own folder was refused
        // still keeps what the person sent it.
        path.join(".instrument", "chats", "2026-10-13-chat", "attachments") +
          " (readOnly)",
        // Written by the agent itself, at the end of a context it has run
        // out of, with nobody there to answer a card.
        path.join(
          ".instrument",
          "chats",
          "2026-10-13-chat",
          "handoff-notes.md",
        ) + " (allow)",
      ]);
    });

    // The same, as paths the agent asks for rather than as rules: the
    // reach of everything written in there, under every rule the person
    // could have, since nothing they allow around the app's data opens
    // anything in it.
    it.each(personRules(paths))(
      "is the same paths and no others under $name",
      (person) => {
        const chat = ".instrument/chats/2026-10-13-chat";
        const other = ".instrument/chats/2026-10-13-other";
        expect(
          reachedInsideAppData(layoutUnder(paths, person).rules, paths),
        ).toEqual([
          ".instrument/chats (read)",
          `${chat} (read)`,
          `${chat}/attachments (read)`,
          `${chat}/attachments/a.pdf (read)`,
          `${chat}/chat.db (read)`,
          `${chat}/handoff-notes.md (read)`,
          `${chat}/handoff-notes.md (write)`,
          `${chat}/settings.json (read)`,
          `${other} (read)`,
          `${other}/attachments (read)`,
          `${other}/attachments/a.pdf (read)`,
          `${other}/chat.db (read)`,
        ]);
      },
    );
  });

  describe("the file tools and the shell", () => {
    const layout = layoutUnder(paths, { grants: [paths.appFiles] });

    it.each([
      ["the keys", `${paths.workspaceMachine}/keys/x`],
      ["the registry of workspaces", `${paths.userData}/workspaces.json`],
      [
        "the workspace's identity",
        `${paths.workspace}/.instrument/workspace.json`,
      ],
    ])(
      "refuse %s to a file tool's read, rather than finding it missing",
      async (_name, target) => {
        const files = await toolFs(layout);
        const resolved = files.resolve(target)._unsafeUnwrap();
        const read = await files.fs.readFileBuffer(resolved).then(
          () => "read",
          (error: unknown) => files.failure(error, resolved),
        );
        expect(typeof read !== "string" && read.error.message).toBe(
          `${JSON.stringify(shellPath(target))} is Instrument's own data, which no command reads or changes; don't look for another way in. Your work folder ($INSTRUMENT_WORK) and this conversation's own folder ($INSTRUMENT_OUTPUT) stay open to you, and a file the person sent is read where they keep it.`,
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
            `ls '${paths.workspaceMachine}/keys'`,
            `cat '${paths.workspaceMachine}/keys/x'`,
            `cat '${paths.userData}/workspaces.json'`,
            `ls '${paths.userData}'`,
            `echo x > '${paths.userData}/Cookies'`,
            `echo x > '${paths.runtime}/bin/probe'`,
            `echo x > '${paths.runtime}/python/probe'`,
            `echo x > '${paths.runtime}/preload/probe'`,
            `echo x > '${paths.runtime}/build/caches/probe'`,
          ].join("; "),
        );
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Permission denied");
        expect(result.stderr).not.toContain("No such file or directory");
        expect(result.stderr).not.toContain("ask_permission");
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
    // A card asks for a folder a place covers, and which place holds the
    // folder other apps' data goes in is the platform's own: macOS has one
    // for `Library`, Windows one for `AppData`, which holds the temp folder
    // this home is planted in. Linux has neither, so a folder beside the
    // app's own data is read without asking and there is no card to check.
    const asksBeside =
      reachOf(layout.rules, path.join(paths.appFiles, "Other"), "read")
        .level === "ask";

    it.runIf(asksBeside)(
      "names the folder beside it, never the one that holds it",
      () => {
        expect(
          ruleRefusal({
            hostPath: `${paths.appFiles}/Other/state.json`,
            op: "read",
            rules: layout.rules,
            spell: (spelled) => spelled,
          }),
        ).toContain(
          `ask for ${JSON.stringify(path.join(paths.appFiles, "Other"))} with ask_permission`,
        );
      },
    );

    it.runIf(asksBeside)("raises none for the folder that holds it", () => {
      expect(
        ruleRefusal({
          hostPath: paths.appFiles,
          isDirectory: true,
          op: "read",
          rules: layout.rules,
          spell: (spelled) => spelled,
        }),
      ).toBe(
        `${JSON.stringify(paths.appFiles)} is in ${JSON.stringify(paths.appFiles)}, which holds Instrument's own data, so it can't be asked for whole. Work in your work folder, or a folder the person names.`,
      );
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
        "reads another chat's work folder",
        `cat '${paths.otherWork}/notes.md'`,
        0,
      ],
      [
        "writes another workspace's work folder",
        `echo x > '${paths.otherWorkspaceWork}/new.md'`,
        0,
      ],
      [
        "lists every workspace's work folders",
        `ls '${path.dirname(paths.workFolders)}'`,
        0,
      ],
      [
        "refuses a listing of the app's folder in the home folder",
        `ls '${paths.homeData}'`,
        1,
      ],
      [
        "refuses what else the app keeps in the home folder",
        `cat '${paths.homeData}/other.json'`,
        1,
      ],
      ["reads another chat's records", `cat '${paths.otherRecord}/chat.db'`, 0],
      [
        "refuses a change to another chat's records",
        `echo x > '${paths.otherRecord}/chat.db'`,
        1,
      ],
      ["refuses the app's own cookies", `cat '${paths.userData}/Cookies'`, 1],
      [
        "refuses a change to the registry of workspaces",
        `echo x > '${paths.userData}/workspaces.json'`,
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
      const result = await execa(
        spawned.file,
        launchNative(spawned, { env: {} }).args,
        {
          reject: false,
        },
      );
      expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
    });

    // A script that catches the refusal and prints it exits 0, and its
    // output is its own: nothing is read out of it.
    it.each([
      `cat '${paths.userData}/workspaces.json' || true`,
      `echo x > '${paths.runtime}/python/probe' || true`,
    ])(
      "a command that exits 0 keeps its output as it was: %s",
      async (script) => {
        const result = await withNativeReach(reach, () =>
          execShim("/bin/sh", ["-c", script], { cwd: paths.work }),
        );
        expect(result.exitCode).toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain(
          "Operation not permitted",
        );
        expect(result.stderr).not.toContain("Instrument's own data");
      },
    );
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

    it.runIf(nativeSandboxed)(
      "orders the Seatbelt profile by where each spelling really is",
      () => {
        const lines = seatbeltProfile(reach).split("\n");
        const opened = lines.indexOf(
          `(allow file-read* file-write* network-outbound (subpath "${paths.appFiles}"))`,
        );
        expect(opened).not.toBe(-1);
        expect(opened).toBeLessThan(
          lines.indexOf(
            `(deny file-read* file-write* network-outbound (subpath "${paths.userData}"))`,
          ),
        );
      },
    );

    it.runIf(nativeSandboxed)(
      "binds what it leads to before the app's data is closed",
      () => {
        const args = bwrapArgs(reach).join(" ");
        const opened = args.indexOf(
          `--bind ${paths.appFiles} ${paths.appFiles}`,
        );
        expect(opened).not.toBe(-1);
        expect(opened).toBeLessThan(args.indexOf(`--tmpfs ${paths.userData}`));
        expect(args).not.toContain(
          `--bind ${path.join(paths.workspaceMachine, "keys")}`,
        );
      },
    );

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
      const result = await execa(
        spawned.file,
        launchNative(spawned, { env: {} }).args,
        {
          reject: false,
        },
      );
      expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
    });
  });

  // `du` walks as the app, and `rg` on Windows has no sandbox to refuse it
  // the app's data, so each leaves it out itself: what the rules close is
  // neither listed nor counted, and what opens inside it is walked.
  describe("a walk with nothing else to hold it", () => {
    const layout = layoutUnder(paths, {});
    // The files the table names that are there, each with whether the
    // rules let the agent read it, spelled as a walk prints it once resolved.
    const files = reachTable(paths).flatMap(([, op, hostPath, level]) =>
      op === "read" && existsSync(hostPath)
        ? [{ hostPath: path.resolve(hostPath), open: level === "allow" }]
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
    it
      .runIf(
        shape.workspace !== undefined &&
          (seatbeltAvailable() || bwrapAvailable()),
      )
      .each([
        ["the workspace", ["-uuu", "--files", paths.workspace], paths.work],
        [
          "the workspace it was cd'd into",
          ["-uuu", "--files"],
          paths.workspace,
        ],
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
        const listed = await execa(
          spawned.file,
          launchNative(spawned, { env: {} }).args,
          {
            cwd,
            reject: false,
          },
        );
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

  describe.runIf(nativeSandboxed)("bubblewrap's arguments", () => {
    const layout = layoutUnder(paths, { grants: [paths.appFiles] });
    const reach = nativeReachFor(layout.rules, layout);
    const args = bwrapArgs(reach).join(" ");

    it("closes this computer's folder, passing through to what opens in it", () => {
      expect(args).toContain(`--perms 0111 --tmpfs ${paths.userData}`);
      expect(args).toContain(`--perms 0111 --tmpfs ${paths.homeData}`);
      const work = path.dirname(paths.workFolders);
      expect(args).toContain(`--bind ${work} ${work}`);
      expect(args).toContain(
        `--ro-bind ${paths.runtime}/python ${paths.runtime}/python`,
      );
    });

    it("binds every chat's records read-only", () => {
      const chats = paths.data.chatsDir;
      expect(`${args} `).toContain(`--ro-bind ${chats} ${chats} `);
    });

    // An empty folder answers a name in it as missing, and the note says
    // why; nothing is listed to stand in for what the folder holds.
    it.each([
      ["another chat's records", paths.otherRecord],
      ["the keys", path.join(paths.workspaceMachine, "keys")],
      [
        "the registry of workspaces",
        path.join(paths.userData, "workspaces.json"),
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
      // A first run makes the folders the app keeps read-only inside a
      // writable one (Drafts/), which every later run then binds.
      people.map(argsFor);
      const two = people.map(argsFor);
      for (let i = 0; i < 1998; i++) {
        const id = `2026-10-14-chat-${String(i).padStart(4, "0")}`;
        mkdirSync(path.join(fresh.data.chatsDir, id, "attachments"), {
          recursive: true,
        });
        writeFileSync(path.join(fresh.data.chatsDir, id, "chat.db"), "");
        mkdirSync(path.join(fresh.workFolders, id));
        writeFileSync(path.join(fresh.workFolders, id, "a.md"), "");
      }
      const many = people.map(argsFor);
      expect(many.map((each) => each.length)).toEqual(
        two.map((each) => each.length),
      );
      expect(many).toEqual(two);
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
    dangerouslyAllowEveryFolder: false,
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
      const result = await execa(
        spawned.file,
        launchNative(spawned, { env: {} }).args,
        {
          reject: false,
        },
      );
      expect(result.exitCode).not.toBe(0);
    },
  );
});
