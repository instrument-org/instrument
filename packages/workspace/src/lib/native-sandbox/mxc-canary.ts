import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { type Rules } from "../permissions/rules";
import { runtimeLayout } from "../runtime-dir";
import { getWorkspaceConfig } from "../workspace-config";

/**
 * Whether MXC holds on this machine, decided by running it rather than by
 * the Windows build: a container that starts but grants everything, or
 * cannot turn a handle back into a drive-letter path (microsoft/mxc#1464,
 * fixed by a Windows update rather than by MXC), passes a check that only
 * asks whether a program ran. So one real spawn, through the same policy
 * generator and launcher every native command uses, proves three things:
 *
 * 1. a file in a granted folder reads, with its contents;
 * 2. `fs.realpathSync.native` on it, which libuv answers with
 *    `GetFinalPathNameByHandleW(..., VOLUME_NAME_DOS)`, returns its
 *    drive-letter path;
 * 3. a folder the rules close cannot be read, and a folder nothing grants
 *    cannot be written, both judged from outside by what was read or made.
 *
 * Before it, the launcher's own probe must report Tier 1 (BaseContainer)
 * with no ACEs to add. The verdict is kept per Windows build and per
 * launcher, in memory and on disk, so an update to either asks again. No
 * answer at all (a timeout) is not kept.
 */
export type MxcVerdict =
  | { kind: "fails"; reason: string }
  | { kind: "noAnswer"; reason: string }
  | { kind: "works" };

/** What the canary hands the sandbox to run one program. */
export type MxcLaunch = (
  reach: { readOnly: string[]; readWrite: string[]; rules: Rules },
  file: string,
  args: string[],
  context: {
    cwd: string;
    env: Record<string, string | undefined>;
    /** Changes the generated policy: only for proving a failure is caught. */
    policy?: <
      Policy extends {
        deniedPaths: string[];
        readonlyPaths: string[];
        readwritePaths: string[];
      },
    >(
      filesystem: Policy,
    ) => Policy;
  },
) => { args: string[]; file: string };

/**
 * A failure to force, for proving each condition sends commands back to
 * running unwrapped: `grant` closes the granted folder, `realpath` reaches
 * the file through a junction into a closed folder, so resolving it is
 * refused as #1464 refused it, and `refuse` opens what should be closed.
 * A forced verdict is never kept.
 */
export type Fault = "grant" | "realpath" | "refuse";

const CANARY_TIMEOUT_MS = 20_000;

/**
 * The app's own folder for what holds its sandbox. No sandboxed command may
 * read or change it (the MXC policy closes it), so none can forge a verdict
 * that turns the sandbox off.
 */
export function sandboxStateDir(): string {
  return runtimeLayout(getWorkspaceConfig().runtimeDir).sandbox;
}

const verdicts = new Map<string, MxcVerdict>();

/** The canary's verdict for the launcher at `exec`, run once per build. */
export function mxcVerdict(exec: string, launch: MxcLaunch): MxcVerdict {
  const fault = faultFromEnv();
  const key = verdictKey(exec);
  const known = fault ? undefined : verdicts.get(key);
  if (known) {
    return known;
  }
  const stored = fault ? undefined : readStoredVerdict(key);
  if (stored) {
    verdicts.set(key, stored);
    return stored;
  }
  const verdict = runMxcCanary(exec, launch, fault);
  if (verdict.kind !== "works") {
    console.warn(
      `MXC does not hold native commands here (${verdict.kind}): ${verdict.reason}`,
    );
  }
  if (verdict.kind !== "noAnswer" && !fault) {
    verdicts.set(key, verdict);
    writeStoredVerdict(key, verdict);
  }
  return verdict;
}

function faultFromEnv(): Fault | undefined {
  // The app's own environment, read live, as any process's.
  const env: NodeJS.ProcessEnv = process.env;
  const fault = env.INSTRUMENT_MXC_CANARY_FAULT;
  return fault === "grant" || fault === "realpath" || fault === "refuse"
    ? fault
    : undefined;
}

/**
 * The Windows build with its update revision (`10.0.26200.9711`), since a
 * fix like #1464's lands in a cumulative update, and the launcher's size
 * and time, so a new MXC asks again.
 */
function verdictKey(exec: string): string {
  let launcher = "missing";
  try {
    const stats = statSync(exec);
    launcher = `${stats.size}-${Math.round(stats.mtimeMs)}`;
  } catch {
    // Left as missing; the canary then says why.
  }
  return `${os.release()}.${updateRevision() ?? "?"} ${launcher}`;
}

/** Windows' update build revision (UBR), read from the registry. */
function updateRevision(): number | undefined {
  try {
    const output = execFileSync(
      "reg.exe",
      [
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
        "/v",
        "UBR",
      ],
      { encoding: "utf8", timeout: 5000, windowsHide: true },
    );
    const hex = /UBR\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(output)?.[1];
    return hex === undefined ? undefined : Number.parseInt(hex, 16);
  } catch {
    return undefined;
  }
}

function verdictFile(): string {
  return path.join(sandboxStateDir(), "mxc-verdict.json");
}

function readStoredVerdict(key: string): MxcVerdict | undefined {
  try {
    // Written only by writeStoredVerdict below, in a folder no sandboxed
    // command reaches.
    const stored = JSON.parse(readFileSync(verdictFile(), "utf8")) as {
      key?: unknown;
      verdict?: MxcVerdict;
    };
    return stored.key === key &&
      (stored.verdict?.kind === "works" || stored.verdict?.kind === "fails")
      ? stored.verdict
      : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredVerdict(key: string, verdict: MxcVerdict) {
  try {
    mkdirSync(sandboxStateDir(), { recursive: true });
    writeFileSync(verdictFile(), JSON.stringify({ key, verdict }));
  } catch {
    // Kept in memory for this run; the next launch asks again.
  }
}

/**
 * The program the canary runs: four checks, one JSON line. Its arguments
 * are the granted file, the file to resolve, the closed file and the file
 * to try making where nothing grants a change.
 */
const CANARY_SCRIPT = `
const fs = require("fs");
const [, granted, resolve, closed, escape] = process.argv;
const out = {};
const failed = (error) => ({ error: String(error && error.code || error) });
try { out.read = fs.readFileSync(granted, "utf8"); } catch (e) { out.read = failed(e); }
try { out.real = fs.realpathSync.native(resolve); } catch (e) { out.real = failed(e); }
try { fs.readFileSync(closed); out.closed = "read"; } catch (e) { out.closed = failed(e); }
try { fs.writeFileSync(escape, "x"); out.escape = "wrote"; } catch (e) { out.escape = failed(e); }
process.stdout.write(JSON.stringify(out));
`;

/** Runs the canary now, without the cache. */
export function runMxcCanary(
  exec: string,
  launch: MxcLaunch,
  fault?: Fault,
): MxcVerdict {
  const probe = probeTier(exec);
  if (probe) {
    return probe;
  }
  const root = path.join(
    getWorkspaceConfig().runtimeDir,
    "mxc-canary",
    randomUUID(),
  );
  try {
    return runInFolder(root, launch, fault);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/** The launcher's own word on the tier it would pick here. */
function probeTier(exec: string): MxcVerdict | undefined {
  let output: string;
  try {
    output = execFileSync(exec, ["--probe"], {
      encoding: "utf8",
      timeout: CANARY_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    return {
      kind: "noAnswer",
      reason: `--probe did not answer: ${String(error)}`,
    };
  }
  let tier: unknown;
  let needsDaclAugmentation: unknown;
  try {
    // The launcher's documented `--probe` output.
    ({ needsDaclAugmentation, tier } = JSON.parse(output) as {
      needsDaclAugmentation?: unknown;
      tier?: unknown;
    });
  } catch {
    return { kind: "fails", reason: `--probe printed ${output.slice(0, 200)}` };
  }
  return tier === "base-container" && needsDaclAugmentation === false
    ? undefined
    : {
        kind: "fails",
        reason: `the launcher would use ${String(tier)}${needsDaclAugmentation ? ", adding ACEs" : ""}, not BaseContainer`,
      };
}

function runInFolder(
  root: string,
  launch: MxcLaunch,
  fault: Fault | undefined,
): MxcVerdict {
  const granted = path.join(root, "granted");
  const closed = path.join(root, "closed");
  const token = randomUUID();
  mkdirSync(granted, { recursive: true });
  mkdirSync(closed, { recursive: true });
  writeFileSync(path.join(granted, "canary.txt"), token);
  writeFileSync(path.join(closed, "secret.txt"), token);
  // The file to resolve: the granted one, or with the realpath fault the
  // same name through a junction into the closed folder.
  let resolve = path.join(granted, "canary.txt");
  if (fault === "realpath") {
    symlinkSync(closed, path.join(granted, "through"), "junction");
    resolve = path.join(granted, "through", "secret.txt");
  }
  const escape = path.join(root, "escape.txt");
  const rules: Rules = {
    home: os.homedir(),
    rules: [
      { level: "allow", path: granted, source: "grant" },
      { denied: true, level: "never", path: closed, source: "grant" },
    ],
    dangerouslyAllowEveryFolder: false,
  };
  const spawned = launch(
    { readOnly: [], readWrite: [], rules },
    process.execPath,
    [
      "-e",
      CANARY_SCRIPT,
      path.join(granted, "canary.txt"),
      resolve,
      path.join(closed, "secret.txt"),
      escape,
    ],
    {
      cwd: granted,
      env: {
        ...canaryEnv(),
        ...getWorkspaceConfig().nodeExecEnv,
      },
      policy: (filesystem) =>
        fault === "grant"
          ? {
              ...filesystem,
              deniedPaths: [...filesystem.deniedPaths, granted],
              readwritePaths: filesystem.readwritePaths.filter(
                (folder) => folder.toLowerCase() !== granted.toLowerCase(),
              ),
            }
          : fault === "refuse"
            ? {
                ...filesystem,
                deniedPaths: filesystem.deniedPaths.filter(
                  (folder) => folder.toLowerCase() !== closed.toLowerCase(),
                ),
                readwritePaths: [...filesystem.readwritePaths, root],
              }
            : filesystem,
    },
  );
  let stdout: string;
  try {
    stdout = execFileSync(spawned.file, spawned.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: CANARY_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    // execFileSync's error carries the spawn's fields, which its type omits.
    const failure = error as {
      code?: string;
      signal?: string | null;
      status?: number | null;
      stderr?: string;
    };
    if (failure.code === "ETIMEDOUT" || failure.signal) {
      return { kind: "noAnswer", reason: "the canary did not finish" };
    }
    return {
      kind: "fails",
      reason: `the canary exited ${String(failure.status)}: ${String(
        failure.stderr ?? "",
      )
        .trim()
        .slice(0, 300)}`,
    };
  }
  return judgeCanary(stdout, {
    escaped: existsSync(escape),
    expectedPath: path.join(granted, "canary.txt"),
    token,
  });
}

/**
 * The verdict from what the canary printed and what it left on the disk.
 * Every condition must hold; the first that does not is the reason.
 */
export function judgeCanary(
  stdout: string,
  {
    escaped,
    expectedPath,
    token,
  }: {
    /** Whether the file it should not have been able to make exists. */
    escaped: boolean;
    expectedPath: string;
    token: string;
  },
): MxcVerdict {
  let out: {
    closed?: unknown;
    escape?: unknown;
    read?: unknown;
    real?: unknown;
  };
  try {
    // The canary script's own output, checked field by field below.
    out = JSON.parse(stdout) as typeof out;
  } catch {
    return {
      kind: "fails",
      reason: `the canary printed ${stdout.slice(0, 200)}`,
    };
  }
  if (out.read !== token) {
    return {
      kind: "fails",
      reason: `a granted file did not read: ${JSON.stringify(out.read)}`,
    };
  }
  if (
    typeof out.real !== "string" ||
    !/^[A-Za-z]:\\/.test(out.real) ||
    out.real.toLowerCase() !== expectedPath.toLowerCase()
  ) {
    return {
      kind: "fails",
      reason: `a handle did not resolve to its drive-letter path: ${JSON.stringify(out.real)}`,
    };
  }
  if (out.closed === "read") {
    return { kind: "fails", reason: "a closed folder could be read" };
  }
  if (out.escape === "wrote" || escaped) {
    return {
      kind: "fails",
      reason: "a folder nothing grants could be written",
    };
  }
  return { kind: "works" };
}

/** What a program needs to start on Windows, and nothing of the app's. */
function canaryEnv(): Record<string, string | undefined> {
  const kept = [
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "PATH",
    "PATHEXT",
    "LOCALAPPDATA",
    "APPDATA",
    "USERPROFILE",
    "TEMP",
    "TMP",
  ];
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      kept.includes(name.toUpperCase()),
    ),
  );
}
