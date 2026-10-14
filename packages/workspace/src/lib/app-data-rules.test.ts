import { execa } from "execa";
import { Bash } from "just-bash";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
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
  bwrapArgs,
  seatbeltAvailable,
  wrapNativeCommand,
} from "./native-sandbox";
import { raiseAsk } from "./permissions/asks";
import { nativeReachFor } from "./permissions/chat-rules";
import { ruleRefusal } from "./permissions/rules-fs";
import { reachOf, type Rules, rulesFor } from "./permissions/rules";
import { resolveAgentPath } from "./resolve-agent-path";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { buildBashFs, buildWorkspaceFsLayout } from "./workspace-fs-layout";

vi.mock("./permissions/asks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./permissions/asks")>()),
  raiseAsk: vi.fn(),
}));

/**
 * The app's own data, laid out as on a person's computer: this computer's
 * folder where the platform keeps other apps' data, the default workspace
 * and the runtime folder in it, and one chat's records and work beside
 * another's. Inside it everything is refused, plainly and with no card,
 * whatever the person allowed around it, but for what the app opens.
 */
const APP_FILES =
  process.platform === "darwin"
    ? path.join("Library", "Application Support")
    : process.platform === "win32"
      ? path.join("AppData", "Roaming")
      : ".config";

const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "app-data-")));
const appFiles = path.join(home, APP_FILES);
const machine = path.join(appFiles, "Instrument");
const workspaceMachine = path.join(machine, "workspaces-data", "default");
const workspace = path.join(machine, "workspace");
const runtime = path.join(machine, "runtime");
const work = path.join(workspaceMachine, "work", "2026-10-13-chat");
const record = path.join(workspace, "chats", "2026-10-13-chat");
const otherWork = path.join(workspaceMachine, "work", "2026-10-13-other");
const otherRecord = path.join(workspace, "chats", "2026-10-13-other");

const settings = { apps: [], folders: [], places: {}, withoutAsking: false };
const previous = getWorkspaceConfig();
const sessionId = StoreId.newSessionId();

// Laid down and set before the cases below are collected, since each
// describe builds its layout from the config as it collects.
for (const file of [
  `${work}/notes.md`,
  `${record}/attachments/a.pdf`,
  `${record}/chat.db`,
  `${record}/settings.json`,
  `${otherRecord}/chat.db`,
  `${otherRecord}/attachments/a.pdf`,
  `${otherWork}/notes.md`,
  `${workspace}/.instrument/workspace.json`,
  `${workspace}/.instrument/preferences.json`,
  `${workspace}/skills/mine/SKILL.md`,
  `${workspace}/apps/linear/app.json`,
  `${workspaceMachine}/keys/x`,
  `${workspaceMachine}/browser/Cookies`,
  `${workspaceMachine}/permissions.json`,
  `${machine}/Cookies`,
  `${machine}/workspaces.json`,
  `${runtime}/caches/uv/x`,
  `${runtime}/config/npmrc`,
  `${runtime}/python/bin/python3`,
  `${runtime}/skills/pdf/SKILL.md`,
  `${runtime}/environments/abc/x`,
  `${runtime}/bin/node`,
  `${appFiles}/Other/state.json`,
]) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "secret");
}
setWorkspaceConfig({
  ...previous,
  appsDir: AbsolutePathSchema.parse(path.join(workspace, "apps")),
  chatsDir: AbsolutePathSchema.parse(path.join(workspace, "chats")),
  machineDir: AbsolutePathSchema.parse(machine),
  rootDir: WorkspaceDirSchema.parse(workspace),
  runtimeDir: AbsolutePathSchema.parse(runtime),
  tempFolders: [],
  workFoldersDir: AbsolutePathSchema.parse(path.join(workspaceMachine, "work")),
  workspaceMachineDir: AbsolutePathSchema.parse(workspaceMachine),
});

afterAll(() => {
  setWorkspaceConfig(previous);
  rmSync(home, { force: true, recursive: true });
});

beforeEach(() => {
  vi.mocked(raiseAsk).mockClear();
});

/** The chat's layout under the person's rules, its home folder reached. */
function layoutUnder({
  grants = [],
  opened = [],
  withoutAsking = false,
}: {
  /** Folders the chat was allowed by a card. */
  grants?: string[];
  /** Folders Settings › Permissions allows. */
  opened?: string[];
  withoutAsking?: boolean;
}) {
  const rules: Rules = {
    ...rulesFor({
      grants: grants.map((grant) => ({
        grantedAt: new Date(0),
        path: AbsolutePathSchema.parse(grant),
        source: "card" as const,
      })),
      home,
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
    chatHostRoot: WorkDirSchema.parse(work),
    folders: {
      [home]: {
        access: "read-only",
        id: MountedFolder.IdSchema.parse("home"),
        path: AbsolutePathSchema.parse(home),
      },
    },
    recordHostRoot: ChatDirSchema.parse(record),
    rules,
  });
}

const PERSON_RULES = [
  { name: "no rule of the person's" },
  { grants: [appFiles], name: "a card's yes to the folder holding it" },
  { grants: [home], name: "a card's yes to the home folder" },
  { name: "Settings allowing the disk", opened: [path.parse(home).root] },
  {
    name: "Settings allowing its keys",
    opened: [path.join(workspaceMachine, "keys")],
  },
  { name: "folders used without asking", withoutAsking: true },
];

const REACH = [
  ["its own work folder", "read", `${work}/notes.md`, "allow"],
  ["its own work folder", "write", `${work}/notes.md`, "allow"],
  ["what it was sent", "read", `${record}/attachments/a.pdf`, "allow"],
  ["what it was sent", "write", `${record}/attachments/a.pdf`, "never"],
  ["its handoff notes", "write", `${record}/handoff-notes.md`, "allow"],
  ["its own chat.db", "read", `${record}/chat.db`, "never"],
  ["its own settings.json", "read", `${record}/settings.json`, "never"],
  ["another chat's records", "read", `${otherRecord}/chat.db`, "never"],
  [
    "what another chat was sent",
    "read",
    `${otherRecord}/attachments/a.pdf`,
    "never",
  ],
  ["another chat's work folder", "read", `${otherWork}/notes.md`, "never"],
  [
    "the workspace's identity",
    "read",
    `${workspace}/.instrument/workspace.json`,
    "never",
  ],
  [
    "the person's preferences",
    "read",
    `${workspace}/.instrument/preferences.json`,
    "never",
  ],
  ["the keys", "read", `${workspaceMachine}/keys/x`, "never"],
  ["the browser data", "read", `${workspaceMachine}/browser/Cookies`, "never"],
  ["the folder rules", "read", `${workspaceMachine}/permissions.json`, "never"],
  ["the app's own browser profile", "read", `${machine}/Cookies`, "never"],
  ["the registry of workspaces", "read", `${machine}/workspaces.json`, "never"],
  [
    "the workspace's skills",
    "write",
    `${workspace}/skills/mine/SKILL.md`,
    "allow",
  ],
  [
    "the workspace's apps",
    "write",
    `${workspace}/apps/linear/app.json`,
    "allow",
  ],
  ["the runtime's caches", "write", `${runtime}/caches/uv/x`, "allow"],
  ["the runtime's config", "write", `${runtime}/config/npmrc`, "allow"],
  ["the managed Python", "read", `${runtime}/python/bin/python3`, "allow"],
  ["the managed Python", "write", `${runtime}/python/bin/python3`, "never"],
  [
    "the skills the app ships",
    "read",
    `${runtime}/skills/pdf/SKILL.md`,
    "allow",
  ],
  [
    "the skills the app ships",
    "write",
    `${runtime}/skills/pdf/SKILL.md`,
    "never",
  ],
  ["a skill's environment", "read", `${runtime}/environments/abc/x`, "allow"],
  ["a skill's environment", "write", `${runtime}/environments/abc/x`, "never"],
  ["the bin links", "read", `${runtime}/bin/node`, "allow"],
  ["the bin links", "write", `${runtime}/bin/node`, "never"],
  [
    "bubblewrap's stand-in for a closed file",
    "read",
    `${runtime}/sandbox/closed-file`,
    "never",
  ],
] as const;

describe.each(PERSON_RULES)("under $name", (personRules) => {
  const layout = layoutUnder(personRules);

  it.each(REACH)("%s: %s %s is %s", (_name, op, hostPath, level) => {
    expect(reachOf(layout.rules, hostPath, op).level).toBe(level);
  });

  it.each(REACH.filter(([, , , level]) => level === "never"))(
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
  const layout = layoutUnder({ grants: [appFiles] });

  it.each([
    ["the keys", `${workspaceMachine}/keys/x`],
    ["another chat's work folder", `${otherWork}/notes.md`],
    ["another chat's settings", `${otherRecord}/settings.json`],
    ["its own chat.db", `${record}/chat.db`],
  ])("refuse %s to a read, rather than finding it missing", (_name, target) => {
    const read = resolveAgentPath({ inputPath: target, layout });
    expect(read.isErr() && read.error.message).toBe(
      `${target} is Instrument's own data, which no command reads or changes. Don't look for another way in.`,
    );
  });

  it.skipIf(process.platform === "win32")(
    "refuses a listing and a read in the shell, saying it is not allowed",
    async () => {
      const bash = new Bash({
        cwd: layout.chat.shellRoot,
        fs: await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 }),
      });
      const result = await bash.exec(
        `ls '${otherWork}'; cat '${workspaceMachine}/keys/x'; ls '${machine}'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Permission denied");
      expect(result.stderr).not.toContain("No such file or directory");
      expect(raiseAsk).not.toHaveBeenCalled();
    },
  );
});

describe("a card for something beside the app's own data", () => {
  const layout = layoutUnder({});

  it("names the folder beside it, never the one that holds it", () => {
    ruleRefusal({
      hostPath: `${appFiles}/Other/state.json`,
      op: "read",
      rules: layout.rules,
      spell: (spelled) => spelled,
    });
    expect(vi.mocked(raiseAsk).mock.calls).toEqual([
      [expect.anything(), "folder", path.join(appFiles, "Other")],
    ]);
  });

  it("raises none for the folder that holds it", () => {
    expect(
      ruleRefusal({
        hostPath: appFiles,
        isDirectory: true,
        op: "read",
        rules: layout.rules,
        spell: (spelled) => spelled,
      }),
    ).toBe(
      `${appFiles} is in ${appFiles}, which holds Instrument's own data, so no card can open it whole. Work in this conversation's folder, or a folder the person names.`,
    );
    expect(raiseAsk).not.toHaveBeenCalled();
  });
});

describe.runIf(seatbeltAvailable())("a native command on this Mac", () => {
  const layout = layoutUnder({ grants: [appFiles] });
  const reach = nativeReachFor(layout.rules, layout);

  it.each([
    ["reads its own work folder", `cat '${work}/notes.md'`, 0],
    ["writes its own work folder", `echo x > '${work}/new.md'`, 0],
    ["reads the managed Python", `cat '${runtime}/python/bin/python3'`, 0],
    ["writes the runtime's caches", `echo x > '${runtime}/caches/uv/y'`, 0],
    ["refuses the keys", `cat '${workspaceMachine}/keys/x'`, 1],
    ["refuses another chat's work folder", `cat '${otherWork}/notes.md'`, 1],
    [
      "refuses a listing of the work folders",
      `ls '${workspaceMachine}/work'`,
      1,
    ],
    ["refuses another chat's records", `cat '${otherRecord}/chat.db'`, 1],
    ["refuses the app's own browser profile", `cat '${machine}/Cookies'`, 1],
    [
      "refuses a change to the managed Python",
      `echo x > '${runtime}/python/bin/python3'`,
      1,
    ],
    [
      "reads beside it, where the card opened",
      `cat '${appFiles}/Other/state.json'`,
      0,
    ],
  ])("%s", async (_name, script, exitCode) => {
    const spawned = wrapNativeCommand("/bin/sh", ["-c", script], reach);
    const result = await execa(spawned.file, spawned.args, { reject: false });
    expect(result.exitCode === 0 ? 0 : 1).toBe(exitCode);
  });
});

describe("the app's own data in a temp folder, which a link leads to", () => {
  const spelled = mkdtempSync(path.join(os.tmpdir(), "app-data-linked-"));
  const real = realpathSync(spelled);
  writeFileSync(path.join(spelled, "secret"), "secret");
  const rules: Rules = {
    home,
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
      const result = await execa(spawned.file, spawned.args, { reject: false });
      expect(result.exitCode).not.toBe(0);
    },
  );
});

describe("bubblewrap's arguments", () => {
  const layout = layoutUnder({ grants: [appFiles] });
  const args = bwrapArgs(nativeReachFor(layout.rules, layout)).join(" ");

  it("closes this computer's folder, passing through to what opens in it", () => {
    expect(args).toContain(`--perms 0111 --tmpfs ${machine}`);
    expect(args).toContain(`--bind ${work} ${work}`);
    expect(args).toContain(`--ro-bind ${runtime}/python ${runtime}/python`);
    expect(args).not.toContain(`--bind ${otherWork}`);
    expect(args).not.toContain(`${workspaceMachine}/keys`);
  });
});
