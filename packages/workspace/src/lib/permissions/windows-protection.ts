import { execFile } from "node:child_process";
import os from "node:os";
import nodePath from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { APP_NAME } from "@instrument-org/shared";

import { type Asker, recordAsk } from "../chat/asks";
import { getWorkspaceConfig } from "../workspace-config";

// Windows' ransomware protection (Controlled folder access) keeps programs
// it does not trust from changing the folders it guards, and a blocked
// write fails as a missing file (ENOENT), so nothing in the error says what
// happened. Defender logs each block as event 1123 naming the program and
// the folder, which is what this reads: never the error.

const execFileAsync = promisify(execFile);

/** Where Defender keeps the setting, and where a policy that sets it does. */
const MODE_KEYS = [
  String.raw`HKLM\SOFTWARE\Policies\Microsoft\Windows Defender\Windows Defender Exploit Guard\Controlled Folder Access`,
  String.raw`HKLM\SOFTWARE\Microsoft\Windows Defender\Windows Defender Exploit Guard\Controlled Folder Access`,
];
const MODE_VALUE = "EnableControlledFolderAccess";

/** The log Defender records each block in, readable without elevation. */
const DEFENDER_LOG = "Microsoft-Windows-Windows Defender/Operational";
/** "Controlled Folder Access blocked a program from changing a folder." */
const BLOCK_EVENT_ID = 1123;

/** How long a block's event may take to land in the log after the write failed. */
export const BLOCK_EVENT_WAIT_MS = 6000;
/**
 * How long each look at the log waits after the last: tight while a block
 * usually lands, a second or two after the write, then looser.
 */
export function blockEventPollMs(waitedMs: number): number {
  return waitedMs < 2000 ? 250 : 500;
}

/** How long a read of the setting stands before it is read again. */
const MODE_FRESH_MS = 30_000;

/** A write the protection blocked, as Defender logged it. */
export interface ProtectionBlock {
  /** The folder or file it kept the program from changing, expanded. */
  path: string;
  /** The program it blocked, by its path. */
  program: string;
}

/**
 * The setting's value in `reg query`'s answer for one key: 0 off, 1 block,
 * 2 audit (logs and lets the write through). Undefined when the key does
 * not hold it.
 */
export function regDword(output: string, name: string): number | undefined {
  const match = new RegExp(
    String.raw`^\s*${name}\s+REG_DWORD\s+0x([0-9a-f]+)\s*$`,
    "im",
  ).exec(output);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 16);
}

let mode: { at: number; blocks: Promise<boolean> } | undefined;

/**
 * Whether the protection blocks writes on this computer: a policy's value
 * where one sets it, else the person's own. Read from the registry, cached
 * for a while; never on any other system.
 */
export function protectionBlocks(): Promise<boolean> {
  if (process.platform !== "win32") {
    return Promise.resolve(false);
  }
  if (mode === undefined || Date.now() - mode.at > MODE_FRESH_MS) {
    mode = { at: Date.now(), blocks: readMode() };
  }
  return mode.blocks;
}

async function readMode(): Promise<boolean> {
  for (const key of MODE_KEYS) {
    const value = await execFileAsync(
      "reg.exe",
      ["query", key, "/v", MODE_VALUE],
      {
        timeout: 5000,
        windowsHide: true,
      },
    ).then(
      ({ stdout }) => regDword(stdout, MODE_VALUE),
      // A key that is not there is a setting nobody made.
      () => undefined,
    );
    if (value !== undefined) {
      return value === 1;
    }
  }
  return false;
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

function unescapeXml(text: string): string {
  return text.replaceAll(
    /&(amp|apos|gt|lt|quot);/g,
    (_, name: string) => XML_ENTITIES[name] ?? "",
  );
}

/** The shell folders Defender names a path by, beside the environment's own variables. */
const SHELL_FOLDERS: Record<string, string> = {
  desktopdirectory: "Desktop",
  mydocuments: "Documents",
  mymusic: "Music",
  mypictures: "Pictures",
  myvideo: "Videos",
  personal: "Documents",
};

/** A path as Defender logs it (`%userprofile%\Documents\`), as the disk spells it. */
export function expandEventPath(
  logged: string,
  {
    env = process.env,
    home = os.homedir(),
  }: { env?: NodeJS.ProcessEnv; home?: string } = {},
): string {
  const expanded = logged.replaceAll(/%([^%]+)%/g, (whole, name: string) => {
    const key = name.toLowerCase();
    if (key === "userprofile") {
      return home;
    }
    const shell = SHELL_FOLDERS[key];
    if (shell !== undefined) {
      return nodePath.win32.join(home, shell);
    }
    const variable = Object.keys(env).find(
      (candidate) => candidate.toLowerCase() === key,
    );
    return variable === undefined ? whole : (env[variable] ?? whole);
  });
  return expanded.replace(/[\\/]+$/, "");
}

/** Every block in `wevtutil`'s XML for the log's events, oldest first. */
export function parseBlockEvents(
  xml: string,
  expand: (logged: string) => string = expandEventPath,
): ProtectionBlock[] {
  const blocks: ProtectionBlock[] = [];
  for (const [event] of xml.matchAll(/<Event[\s>][\s\S]*?<\/Event>/g)) {
    const field = (name: string) => {
      const match = new RegExp(
        String.raw`<Data Name='${name}'>([^<]*)</Data>`,
      ).exec(event);
      return match?.[1] === undefined ? undefined : unescapeXml(match[1]);
    };
    const path = field("Path");
    const program = field("Process Name");
    if (path && program) {
      blocks.push({ path: expand(path), program });
    }
  }
  return blocks.toReversed();
}

/** The blocks Defender logged since `since`, newest last. */
async function blocksSince(since: Date): Promise<ProtectionBlock[]> {
  const query = `*[System[(EventID=${BLOCK_EVENT_ID}) and TimeCreated[@SystemTime>='${since.toISOString()}']]]`;
  try {
    const { stdout } = await execFileAsync(
      "wevtutil.exe",
      ["qe", DEFENDER_LOG, `/q:${query}`, "/f:xml", "/rd:true", "/c:50"],
      { maxBuffer: 4 * 1024 * 1024, timeout: 5000, windowsHide: true },
    );
    return parseBlockEvents(stdout);
  } catch {
    return [];
  }
}

/** A Windows path folded for comparing: one separator, no case, no trailing one. */
function fold(hostPath: string): string {
  return nodePath.win32
    .normalize(hostPath.replaceAll("/", "\\"))
    .replace(/\\+$/, "")
    .toLowerCase();
}

/** Whether one path is the other or holds it, either way round. */
export function pathsTouch(a: string, b: string): boolean {
  const [x, y] = [fold(a), fold(b)];
  return x === y || x.startsWith(`${y}\\`) || y.startsWith(`${x}\\`);
}

/**
 * Whether `program` is one of the app's: the app itself or a program it
 * ships (both under its install folder), one it set up in its runtime
 * folder (Python, a skill's environment), or one the call just ran.
 */
export function isOurProgram(
  program: string,
  {
    installDir = nodePath.dirname(process.execPath),
    ran = [],
    runtimeDir = getWorkspaceConfig().runtimeDir,
  }: { installDir?: string; ran?: readonly string[]; runtimeDir?: string } = {},
): boolean {
  const folded = fold(program);
  return (
    [installDir, runtimeDir].some((dir) =>
      folded.startsWith(`${fold(dir)}\\`),
    ) || ran.some((path) => fold(path) === folded)
  );
}

/**
 * The blocks of our programs since `since` that touch `path` (any, when it
 * is not given), waiting a few seconds for the log to catch up with a write
 * that just failed. Only called once the protection is known to block.
 */
export async function awaitOurBlocks({
  path,
  ran,
  since,
  waitMs = BLOCK_EVENT_WAIT_MS,
}: {
  path?: string;
  ran?: readonly string[];
  since: Date;
  waitMs?: number;
}): Promise<ProtectionBlock[]> {
  const started = Date.now();
  const deadline = started + waitMs;
  for (;;) {
    const ours = (await blocksSince(since)).filter(
      (block) =>
        isOurProgram(block.program, { ran }) &&
        (path === undefined || pathsTouch(block.path, path)),
    );
    if (ours.length > 0 || Date.now() >= deadline) {
      return ours;
    }
    await sleep(blockEventPollMs(Date.now() - started));
  }
}

/**
 * What kept a write by the app itself out of `target` since `since`: the
 * folder the protection guards and the programs it blocked there, once the
 * log names one of ours touching it. Nothing when the protection does not
 * block, off Windows, or when the log names nothing of ours.
 */
export async function confirmedBlock(
  target: string,
  since: Date,
): Promise<undefined | { folder: string; programs: string[] }> {
  if (!(await protectionBlocks())) {
    return undefined;
  }
  const blocks = await awaitOurBlocks({ path: target, since });
  const [first] = blocks;
  if (first === undefined) {
    return undefined;
  }
  return {
    folder: guardedFolderOf(first.path),
    programs: [...new Set(blocks.map((block) => block.program))],
  };
}

/** The folders the protection guards by default, under the home folder. */
const GUARDED = [
  "Desktop",
  "Documents",
  "Favorites",
  "Music",
  "Pictures",
  "Videos",
];

/**
 * The folder a card names for a blocked path: the guarded folder holding it
 * (Documents for `Documents\Reports\q3.xlsx`), else the path itself.
 */
export function guardedFolderOf(
  blocked: string,
  home: string = os.homedir(),
): string {
  const folded = fold(blocked);
  const root = GUARDED.map((name) => nodePath.win32.join(home, name)).find(
    (candidate) =>
      folded === fold(candidate) || folded.startsWith(`${fold(candidate)}\\`),
  );
  return root ?? blocked;
}

/**
 * Set in the bash worker, whose shell meets the blocks but holds none of
 * the chat's cards: each goes to the main thread instead.
 */
let forward:
  | ((asker: Asker, folder: string, programs: string[]) => void)
  | undefined;

export function setProtectionForwarder(
  next: NonNullable<typeof forward>,
): void {
  forward = next;
}

/** Raises the chat's card for programs the protection kept out of `folder`. */
export async function raiseProtectionCard(
  asker: Asker,
  folder: string,
  programs: string[],
): Promise<void> {
  if (forward) {
    forward(asker, folder, programs);
    return;
  }
  await recordAsk(asker, "folder", folder, {
    allowed: "allowed",
    programs,
    status: "windows-blocked",
  });
}

/**
 * Raises a card for each folder `blocks` name, and answers what the agent
 * is told beside the failure: what blocked it, since the error itself says
 * the file is missing.
 */
export async function reportBlocks(
  blocks: readonly ProtectionBlock[],
  asker: Asker | undefined,
  spell: (hostPath: string) => string,
): Promise<string> {
  const byFolder = new Map<string, Set<string>>();
  for (const block of blocks) {
    const folder = guardedFolderOf(block.path);
    byFolder.set(
      folder,
      (byFolder.get(folder) ?? new Set()).add(block.program),
    );
  }
  const notes: string[] = [];
  for (const [folder, programs] of byFolder) {
    const names = [...programs].map((program) =>
      nodePath.win32.basename(program),
    );
    const shown = JSON.stringify(spell(folder));
    if (asker !== undefined) {
      await raiseProtectionCard(asker, folder, [...programs]);
    }
    notes.push(
      `Windows ransomware protection (Controlled folder access) kept ${names.join(", ")} from changing ${shown}: that is what the error above is, not a missing file. ${
        asker === undefined
          ? `Only the person can let ${APP_NAME} through, under Windows Security › Ransomware protection › Allow an app through Controlled folder access.`
          : "The person now sees a card to let it through, and their answer wakes you; stop here and say what you're waiting for."
      }`,
    );
  }
  return notes.join("\n");
}

/**
 * Lets `programs` through the protection, with Windows' own prompt for an
 * administrator's yes: the one way to change its list, which no unelevated
 * program can. Answers whether the person said yes and the list took it.
 */
export async function allowThroughProtection(
  programs: readonly string[],
): Promise<"allowed" | "canceled" | "failed"> {
  const quoted = programs.map(
    (program) => `'${program.replaceAll("'", "''")}'`,
  );
  const encoded = Buffer.from(
    `Add-MpPreference -ControlledFolderAccessAllowedApplications ${quoted.join(",")}`,
    "utf16le",
  ).toString("base64");
  // 1223 is Windows' "the operation was canceled by the user", which is
  // what declining the prompt throws.
  const outer = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; exit $p.ExitCode } catch { exit 1223 }`;
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", outer],
      { timeout: 5 * 60_000, windowsHide: true },
    );
    return "allowed";
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === 1223
      ? "canceled"
      : "failed";
  }
}
