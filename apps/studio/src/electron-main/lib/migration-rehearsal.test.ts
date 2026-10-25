import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import {
  convertChatSettingsFiles,
  giveChatsTheirFolders,
  migrateWorkspaceLayout,
  type AppConnectionStore,
  convertAppsToAppFiles,
  moveAppsToFolder,
  moveMemoriesToFolder,
  moveSkillsToFolder,
  moveTopicsToFolder,
  convertTopicsToTopicFiles,
  newDeviceId,
  renameChatDatabases,
  settleDrafts,
  settleWorkspaceDb,
} from "@instrument-org/workspace/electron";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { convertChatRecords } from "./convert-chat-records";
import { workspaceLayoutMarks } from "./workspaces";

/**
 * The launch migrations, run against a copy of a real install.
 *
 * This is the one part of the move to visible folders that can lose
 * something a person cannot get back: it runs once per install, over every
 * chat they have, and a bug in it is permanent. The unit tests cover each
 * step over a few seeded files; what they cannot cover is 393 chats written
 * by a year of builds, a workspace half-converted by a beta, or a folder the
 * person made themselves.
 *
 * So it is skipped unless `REHEARSE_WORKSPACE` names a workspace to rehearse
 * on, which in this repo means a copy of one of the real installs:
 *
 *   REHEARSE_WORKSPACE="$HOME/Library/Application Support/Instrument/workspace" \
 *     pnpm --filter @instrument-org/studio exec vitest run \
 *     src/electron-main/lib/migration-rehearsal.test.ts
 *
 * The workspace named is only ever read: everything runs against a clone of
 * it (an APFS clone on macOS, so a 5 GB install costs no space and no time),
 * in a temporary folder that is left behind for reading afterwards.
 *
 * The assertions are ordered by what it would cost to get them wrong, and
 * the first is the only one that can fail on something unrecoverable: a file
 * the person had and no longer has.
 */

const SOURCE = process.env.REHEARSE_WORKSPACE ?? "";

/**
 * Files the migrations are allowed to leave without a copy of their bytes
 * anywhere, because a step turns them into something else. Everything the
 * person themselves put in the workspace (an attachment, a memory, a skill,
 * a file the agent wrote) is outside this list, which is what makes the
 * first assertion worth running.
 */
const TRANSFORMED = [
  // Each chat's conversation becomes its records; the store is set aside in
  // the workspace's folder on this computer, whole, and that copy is checked
  // for separately.
  /(?:^|\/)chat\.db(?:-wal|-shm)?$/,
  /(?:^|\/)task\.db(?:-wal|-shm)?$/,
  // Rewritten in place by a step: the chat's own settings (it gains the name
  // of the folder it claimed), the workspace's marks, its database.
  /(?:^|\/)settings\.json$/,
  /(?:^|\/)state\.json$/,
  /(?:^|\/)workspace\.(?:db|json)(?:-wal|-shm)?$/,
  /(?:^|\/)history\.db(?:-wal|-shm)?$/,
  /(?:^|\/)migrations\.json$/,
  /(?:^|\/)\.layout-version$/,
  // A render: the app writes it from the chat's records and rewrites it
  // whole, so a build that renders differently leaves none of the old bytes.
  /(?:^|\/)CHAT\.md$/,
  // A topic's two hidden files become its one TOPIC.md, and an app's two
  // become its one APP.md.
  /(?:^|\/)instructions\.md$/,
  /(?:^|\/)app\.json$/,
  /(?:^|\/)guide\.md$/,
  // A draft's words and settings become its DRAFT.md.
  /(?:^|\/)draft\.md$/,
  // What a work folder never takes with it when it moves out of the folder
  // holding the records: scratch, and what carries this computer's absolute
  // paths, which the agent's next command makes again where it now works
  // (`REBUILT_ENTRY_NAMES` in split-chat-records.ts).
  /(?:^|\/)(?:\.tmp|\.venv|node_modules)\//,
  // The app's own skills, which 1.x staged a copy of inside every task's
  // work folder. They are the app's to put where it runs, and it does
  // (`APP_SKILL_SOURCES`).
  /(?:^|\/)skills\/(?:instrument|system)\//,
  // macOS writes these beside whatever a person has opened in the Finder.
  /(?:^|\/)\.DS_Store$/,
];

/** A chat's store, under either name a build has given it. */
const A_STORE = /(?:^|\/)(?:chat|task)\.db$/;

/**
 * Long enough for every assertion over a real install: the biggest here is
 * 157,000 files, each read and hashed.
 */
const PATIENCE = 600_000;

let clone: string;
let machineDir: string;
let before: Inventory;
let after: Inventory;
/** The workspace's folder on this computer, where the work and the stores go. */
let machine: Inventory;

interface Entry {
  bytes: number;
  hash: string;
  mtimeMs: number;
}

/** Every file under a folder, by its path relative to that folder. */
type Inventory = Map<string, Entry>;

describe.skipIf(!SOURCE)("the launch migrations on a real workspace", () => {
  beforeAll(async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "migration-rehearsal-"));
    clone = path.join(out, "workspace");
    machineDir = path.join(out, "machine");
    fs.mkdirSync(machineDir, { recursive: true });
    cloneFolder(SOURCE, clone);
    before = await inventory(clone);
    await runLaunchMigrations();
    after = await inventory(clone);
    machine = await inventory(machineDir);
    // eslint-disable-next-line no-console
    console.log(
      `rehearsed ${SOURCE}\n  on ${clone}\n  ${before.size} files in, ${after.size} in the workspace and ${machine.size} in its folder on this computer`,
    );
  }, PATIENCE);

  it(
    "loses no file the person put there",
    () => {
      const held = new Set(
        [...after.values(), ...machine.values()].map((entry) => entry.hash),
      );
      const lost = [...before]
        .filter(([, entry]) => !held.has(entry.hash))
        .map(([where]) => where)
        .filter((where) => !TRANSFORMED.some((pattern) => pattern.test(where)));
      expect({ count: lost.length, first: lost.slice(0, 20) }).toEqual({
        count: 0,
        first: [],
      });
    },
    PATIENCE,
  );

  it("sets every store it converted aside, with none left where a chat is read", () => {
    // The workspace keeps one place for a store it is done with: the chats
    // an earlier build left empty, parked under `.pre-chats/`. A store
    // anywhere else is a chat still on its database.
    const parked = (where: string) =>
      where.startsWith(path.join(".instrument", ".pre-chats"));
    const were = [...before.keys()].filter(
      (where) => A_STORE.test(where) && !parked(where),
    );
    const left = [...after.keys()].filter(
      (where) => A_STORE.test(where) && !parked(where),
    );
    const setAside = [...machine.keys()].filter((where) =>
      where.includes("set-aside"),
    );
    // How many were set aside is not the count of stores that were there: a
    // 1.x task's store is converted by the 1.x migration, and a beta chat's
    // task folders keep their own stores, which the split sets aside under
    // `.pre-chats/` without converting them. That nothing was lost on the way
    // is the assertion above.
    expect({ left, setAside: setAside.length > 0 }).toEqual({
      left: [],
      setAside: were.length > 0,
    });
  });

  it("gives every chat one folder, and no folder two chats", () => {
    const claimed = chatFolderClaims();
    const folders = foldersUnder(path.join(clone, "Chats"));
    const twice = [...claimed.values()].filter(
      (name, index, all) => all.indexOf(name) !== index,
    );
    expect({
      chats: claimed.size,
      claimedTwice: twice,
      folders: folders.length,
      unclaimed: folders.filter(
        (name) => ![...claimed.values()].includes(name),
      ),
      withoutAFolder: [...claimed]
        .filter(([, name]) => !folders.includes(name))
        .map(([id]) => id),
    }).toEqual({
      chats: claimed.size,
      claimedTwice: [],
      folders: claimed.size,
      unclaimed: [],
      withoutAFolder: [],
    });
  });

  it("writes a CHAT.md in every chat's folder, naming the chat it is", () => {
    const claimed = chatFolderClaims();
    const problems: string[] = [];
    for (const [id, name] of claimed) {
      const file = path.join(clone, "Chats", name, "CHAT.md");
      let text: string;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        problems.push(`${name}: no CHAT.md`);
        continue;
      }
      const front = frontMatterOf(text);
      if (front === undefined) {
        problems.push(`${name}: front matter does not parse`);
      }
      if (!text.includes(`instrument://chat/${id}`)) {
        problems.push(`${name}: does not link to ${id}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps what the person sent in one place, never in both", () => {
    // What was sent moves into the chat's own folder only where the person
    // opens that folder, and then at the chat's next write; a workspace in
    // the app's own data, like this clone, keeps it in the record folder.
    // That nothing sent was lost is the assertion above.
    const claimed = chatFolderClaims();
    const inBoth = [...after.keys()]
      .filter(
        (where) =>
          where.startsWith(path.join(".instrument", "chats")) &&
          where.includes(`${path.sep}attachments${path.sep}`),
      )
      .filter((where) => {
        const [, , id, , ...rest] = where.split(path.sep);
        const name = id === undefined ? undefined : claimed.get(id);
        return (
          name !== undefined &&
          fs.existsSync(path.join(clone, "Chats", name, "attachments", ...rest))
        );
      });
    expect(inBoth).toEqual([]);
  });

  it("brings the person's own folders out of .instrument", () => {
    // What was hidden has to be where the person can read it, which means
    // nothing is left behind in `.instrument` for them to never find.
    const left = Object.entries({
      Memory: "memory",
      Skills: "skills",
      Topics: "topics",
    }).flatMap(([visible, hidden]) => {
      const under = path.join(".instrument", hidden) + path.sep;
      const was = [...before.keys()].filter((where) =>
        where.startsWith(under),
      ).length;
      const still = [...after.keys()].filter((where) =>
        where.startsWith(under),
      ).length;
      const now = [...after.keys()].filter((where) =>
        where.startsWith(visible + path.sep),
      ).length;
      return was > 0 && still > 0
        ? [
            `${hidden}/: ${String(was)} were hidden, ${String(still)} still are, ${String(now)} in ${visible}/`,
          ]
        : [];
    });
    expect(left).toEqual([]);
  });

  it("turns each topic's hidden files into the one TOPIC.md", () => {
    const problems: string[] = [];
    for (const name of foldersUnder(path.join(clone, "Topics"))) {
      const folder = path.join(clone, "Topics", name);
      const file = path.join(folder, "TOPIC.md");
      if (!fs.existsSync(file)) {
        problems.push(`${name}: no TOPIC.md`);
        continue;
      }
      const front = frontMatterOf(fs.readFileSync(file, "utf8"));
      if (front === undefined || typeof front.id !== "string") {
        problems.push(`${name}: TOPIC.md names no topic`);
      }
      for (const left of ["instructions.md", ".instrument"]) {
        if (fs.existsSync(path.join(folder, left))) {
          problems.push(`${name}: still holds ${left}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("turns each app's two files into the one APP.md, named for the app", () => {
    const problems: string[] = [];
    for (const name of foldersUnder(path.join(clone, "Apps"))) {
      const folder = path.join(clone, "Apps", name);
      const file = path.join(folder, "APP.md");
      if (!fs.existsSync(file)) {
        problems.push(`${name}: no APP.md`);
        continue;
      }
      const front = frontMatterOf(fs.readFileSync(file, "utf8"));
      if (front === undefined || typeof front.id !== "string") {
        problems.push(`${name}: APP.md names no app`);
      }
      for (const left of ["app.json", "guide.md"]) {
        if (fs.existsSync(path.join(folder, left))) {
          problems.push(`${name}: still holds ${left}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("changes nothing at all when it runs again", async () => {
    // The documents as they stand, so a file written differently the second
    // time can say which line moved rather than only that it did.
    const was = new Map(
      [...after.keys()]
        .filter((where) => /\.(?:md|json)$/.test(where))
        .map((where) => [
          where,
          fs.readFileSync(path.join(clone, where), "utf8"),
        ]),
    );
    await runLaunchMigrations();
    const again = await inventory(clone);
    const known = [...again].flatMap(([where, entry]) => {
      const held = after.get(where);
      if (held === undefined || held.hash === entry.hash) {
        return [];
      }
      return [where];
    });
    // A file written again with the bytes it already had costs nothing to
    // read but everything to sync: a folder in iCloud sees one change per
    // file per launch. So it is reported apart from a file whose bytes
    // actually moved, which is a render that is not deterministic.
    const rewritten = [...again]
      .filter(([where, entry]) => {
        const held = after.get(where);
        return (
          held !== undefined &&
          held.hash === entry.hash &&
          held.mtimeMs !== entry.mtimeMs
        );
      })
      .map(([where]) => where);
    expect({
      changed: known.slice(0, 3).map((where) => ({
        [where]: firstDifference(
          was.get(where) ?? "",
          fs.readFileSync(path.join(clone, where), "utf8"),
        ),
      })),
      changedCount: known.length,
      gone: [...after.keys()].filter((where) => !again.has(where)),
      made: [...again.keys()].filter((where) => !after.has(where)),
      rewrittenCount: rewritten.length,
      rewrittenFirst: rewritten.slice(0, 3),
    }).toEqual({
      changed: [],
      changedCount: 0,
      gone: [],
      made: [],
      rewrittenCount: 0,
      rewrittenFirst: [],
    });
  }, 1_800_000);
});

/**
 * The same steps `createWorkspaceActor` runs before the workspace opens, in
 * the same order. Everything that needs the workspace actor itself (the
 * chat permissions move) is left out and is covered by driving the app.
 */
async function runLaunchMigrations(): Promise<void> {
  renameChatDatabases(clone);
  migrateWorkspaceLayout({
    machineDir,
    marks: workspaceLayoutMarks(clone),
    rootDir: clone,
    workFoldersDir: path.join(machineDir, "work"),
  });
  settleWorkspaceDb({ machineDir, rootDir: clone });
  const deviceId = newDeviceId();
  const { converted } = await convertChatRecords({
    appVersion: "0.0.0-rehearsal",
    deviceId,
    machineDir,
    rootDir: clone,
  });
  await convertChatSettingsFiles({
    chatsDir: path.join(clone, ".instrument", "chats"),
    deviceId,
    machineDir,
  });
  await moveMemoriesToFolder(clone);
  await moveSkillsToFolder(clone);
  await moveTopicsToFolder(clone);
  await moveAppsToFolder(clone);
  await convertTopicsToTopicFiles(clone);
  await convertAppsToAppFiles(clone, { connections: forgottenConnections() });
  await giveChatsTheirFolders(clone, machineDir, converted);
  // A rehearsal moves nothing out of the clone: what a draft left stays.
  await settleDrafts(clone, { moveToTrash: () => Promise.resolve() });
}

/**
 * The app's record of where each app stands, which lives on this computer
 * rather than in the workspace, so a rehearsal has none to read: the
 * conversion restamps nothing and says so in what it returns.
 */
function forgottenConnections(): AppConnectionStore {
  return {
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve({}),
    remove: () => Promise.resolve(),
    set: () => Promise.resolve(),
  };
}

/** Each chat's id and the folder this computer recorded it claimed. */
function chatFolderClaims(): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      fs.readFileSync(
        path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.chatFolders),
        "utf8",
      ),
    );
  } catch {
    return new Map();
  }
  if (typeof parsed !== "object" || parsed === null) {
    return new Map();
  }
  return new Map(
    Object.entries(parsed).flatMap(([id, folder]: [string, unknown]) =>
      typeof folder === "string" && folder ? [[id, folder] as const] : [],
    ),
  );
}

/** A clone on macOS, a copy anywhere else. `to` must not exist. */
function cloneFolder(from: string, to: string): void {
  if (process.platform === "darwin") {
    execFileSync("/bin/cp", ["-Rc", from, to]);
    return;
  }
  fs.cpSync(from, to, { recursive: true });
}

/** The first line that is not the same in both, as `was` then `is`. */
function firstDifference(was: string, is: string): string {
  const left = was.split("\n");
  const right = is.split("\n");
  for (let line = 0; line < Math.max(left.length, right.length); line += 1) {
    if (left[line] !== right[line]) {
      return `line ${String(line + 1)}: ${JSON.stringify(left[line])} became ${JSON.stringify(right[line])}`;
    }
  }
  return "no line differs";
}

function foldersUnder(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return [];
  }
}

/** A file's front matter as a record, or nothing where it has none. */
function frontMatterOf(text: string): Record<string, unknown> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(
    text,
  );
  if (!match) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "") as unknown;
  } catch {
    return undefined;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

async function inventory(dir: string): Promise<Inventory> {
  const found: Inventory = new Map();
  await walk(dir, "");
  return found;

  async function walk(at: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const where = relative ? path.join(relative, entry.name) : entry.name;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        await walk(full, where);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = await fsp.stat(full);
      found.set(where, {
        bytes: stat.size,
        hash: createHash("sha256")
          .update(await fsp.readFile(full))
          .digest("hex"),
        mtimeMs: stat.mtimeMs,
      });
    }
  }
}
