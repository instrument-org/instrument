import { statSync } from "node:fs";
import nodePath from "node:path";

/**
 * Which calls of `ps` and `top`, and of `tasklist` on Windows, may run
 * outside the OS sandbox, to read the person's process list.
 *
 * On macOS both are setuid root, which Seatbelt refuses to exec, and a
 * non-root copy is killed on exec, so sandboxed they cannot run at all. On
 * Linux procps reads `/proc`, and inside bubblewrap's pid namespace it sees
 * only the command's own processes. Outside, each lists every process the
 * person's account can see. Neither program has an option that writes a
 * file or changes a process; what is left out here is what shows another
 * process's environment (macOS `-E`, procps `e` and the `environ` keyword),
 * an option that names a file (procps `-n`/`N`, the namelist), a tty name
 * that is a path, and `top` in its interactive mode, which needs a terminal
 * and takes keystrokes that renice and signal. On Windows a program under
 * MXC sees only the processes in its own container, so `tasklist` runs
 * outside it, without `/s`, `/u` and `/p`, which reach another computer
 * with an account and password.
 *
 * The lists are closed: an option not here refuses the call. Each program
 * runs from its fixed system path, root-owned and writable by no one else,
 * with the environment `unsandboxedEnv` builds from nothing (no `PS_FORMAT`,
 * `PS_SYSMAP`, `HOME` for top's rc file, or `COLUMNS`).
 */

export type ProcessLister = "ps" | "top" | "tasklist";

/** How a short option letter is read: alone, or with a value. */
type Letters = Readonly<Record<string, "flag" | "value">>;

const flags = (letters: string): Record<string, "flag"> =>
  Object.fromEntries(
    letters.split("").map((letter) => [letter, "flag"] as const),
  );
const values = (letters: string): Record<string, "value"> =>
  Object.fromEntries(
    letters.split("").map((letter) => [letter, "value"] as const),
  );

/**
 * macOS ps, from its getopt string `aACcdeEfg:G:hjLlMmO:o:p:rSTt:U:u:vwx`
 * without `E`. With a first argument that has no dash (`ps aux`) it reads
 * every argument with its old string instead, where `g` and `u` take no
 * value.
 */
const DARWIN_PS: Letters = {
  ...flags("aACcdefhjLlMmrSTvwx"),
  ...values("gGOoptUu"),
};
const DARWIN_PS_OLD: Letters = {
  ...flags("aACcdeghjLlMmrSTuvwx"),
  ...values("GOoptU"),
};

/** procps ps, its UNIX options (`-ef`), without `-n` (a namelist file). */
const LINUX_PS_UNIX: Letters = {
  ...flags("AacdeFfHjLlMmNPTVwxy"),
  ...values("CDGgOopqstUu"),
};
/** procps ps, its BSD options (`aux`), without `e` (the environment) or `N`. */
const LINUX_PS_BSD: Letters = {
  ...flags("acfhHjLlmnrSsTuVvwXxZ"),
  ...values("kOopqtU"),
};
/** procps ps, its long options, and whether each takes a value. */
const LINUX_PS_LONG: Readonly<Record<string, "flag" | "value">> = {
  cols: "value",
  columns: "value",
  context: "flag",
  cumulative: "flag",
  deselect: "flag",
  forest: "flag",
  format: "value",
  Group: "value",
  group: "value",
  headers: "flag",
  lines: "value",
  "no-headers": "flag",
  pid: "value",
  ppid: "value",
  "quick-pid": "value",
  rows: "value",
  sid: "value",
  signames: "flag",
  sort: "value",
  tty: "value",
  User: "value",
  user: "value",
  version: "flag",
  width: "value",
};

/** Options whose value is a list of output keywords. */
const FORMAT_OPTIONS = new Set(["O", "o", "format"]);

/** Options whose value is a terminal's name, which ps looks up under /dev. */
const TTY_OPTIONS = new Set(["t", "tty"]);

/** What a call may run as, or why it may not. */
export type ProcessListCall =
  | { allowed: true }
  | { allowed: false; reason: string };

const ALLOWED = { allowed: true } as const;

/** What the agent reads for a refused call: what it may use instead. */
const ALLOWED_HELP: Record<
  ProcessLister,
  Partial<Record<NodeJS.Platform, string>>
> = {
  ps: {
    darwin:
      "`ps` takes the options that list processes: -A -a -C -c -d -e -f -G -g -h -j -L -l -M -m -O -o -p -r -S -T -t -U -u -v -w -x (or `ps aux`); not -E.",
    linux:
      "`ps` takes the options that list processes: -A -e -a -d -N -x -C -G -g -p -q -s -t -u -U -f -F -j -l -L -T -m -H -o -O -w, BSD `aux`, `--sort`, `--forest`, `--no-headers`; not the environment (`e`, `environ`) or a namelist (`-n`).",
  },
  top: {
    darwin:
      "`top` runs only in logging mode: `top -l <samples>` with -o/-O <key>, -n <count>, -s <delay>, -i, -c, -stats <keys>, -pid, -user, -U, -a/-d/-e, -F/-f, -R/-r, -S, -u, -ncols.",
    linux:
      "`top` runs only in batch mode: `top -b -n <iterations>` with -o <field>, -d <delay>, -p <pids>, -u/-U <user>, -w [cols], -c, -H, -i, -S, -s, -1, -E/-e <scale>.",
  },
  tasklist: {
    win32:
      '`tasklist` takes the options that list this computer\'s processes: /v, /svc, /m [module], /apps, /fi "<filter>", /fo table|list|csv, /nh; not /s, /u or /p.',
  },
};

function refuse(
  name: ProcessLister,
  what: string,
  platform: NodeJS.Platform,
): ProcessListCall {
  const help = ALLOWED_HELP[name][platform] ?? "";
  return {
    allowed: false,
    reason: `${name}: ${what} can't be used here. ${help}`,
  };
}

/** A value an option may take: no environment keyword, no tty path. */
function valueRefusal(option: string, value: string): string | undefined {
  if (FORMAT_OPTIONS.has(option) && /env/i.test(value)) {
    return `the \`${value}\` keyword`;
  }
  if (
    TTY_OPTIONS.has(option) &&
    (value.startsWith("/") || value.split("/").includes(".."))
  ) {
    return `the tty \`${value}\``;
  }
  return undefined;
}

/**
 * Read one cluster of letters (`-aux`, `aux`): each must be on the list, and
 * a letter that takes a value takes the rest of the cluster or else the next
 * argument, as getopt does. `joinedValues` false asks a value letter to end
 * its cluster (procps' BSD options).
 */
function readCluster(
  letters: Letters,
  arg: string,
  next: string | undefined,
  { joinedValues = true }: { joinedValues?: boolean } = {},
): { consumed: number; refused?: string } {
  const dash = arg.startsWith("-") ? "-" : "";
  const cluster = arg.slice(dash.length);
  for (let at = 0; at < cluster.length; at++) {
    const letter = cluster.charAt(at);
    const kind = letters[letter];
    if (kind === undefined) {
      return { consumed: 0, refused: `\`${dash}${letter}\`` };
    }
    if (kind === "flag") {
      continue;
    }
    const rest = cluster.slice(at + 1);
    if (rest !== "") {
      if (!joinedValues) {
        return { consumed: 0, refused: `\`${cluster}\`` };
      }
      const bad = valueRefusal(letter, rest);
      return bad === undefined
        ? { consumed: 0 }
        : { consumed: 0, refused: bad };
    }
    if (next === undefined) {
      return {
        consumed: 0,
        refused: `\`${dash}${letter}\` without its value`,
      };
    }
    const bad = valueRefusal(letter, next);
    return bad === undefined ? { consumed: 1 } : { consumed: 1, refused: bad };
  }
  return { consumed: 0 };
}

function classifyDarwinPs(argv: readonly string[]): ProcessListCall {
  const old = argv[0] !== undefined && !argv[0].startsWith("-");
  const letters = old ? DARWIN_PS_OLD : DARWIN_PS;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const first = old && index === 0;
    if (!first && (!arg.startsWith("-") || arg === "-" || arg === "--")) {
      return refuse("ps", `\`${arg}\``, "darwin");
    }
    const step = readCluster(letters, arg, argv[index + 1]);
    if (step.refused !== undefined) {
      return refuse("ps", step.refused, "darwin");
    }
    index += step.consumed;
  }
  return ALLOWED;
}

function classifyLinuxPs(argv: readonly string[]): ProcessListCall {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const next = argv[index + 1];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const kind = Object.hasOwn(LINUX_PS_LONG, name)
        ? LINUX_PS_LONG[name]
        : undefined;
      if (kind === undefined || (kind === "flag" && eq !== -1)) {
        return refuse("ps", `\`${arg}\``, "linux");
      }
      if (kind === "value") {
        const value = eq === -1 ? next : arg.slice(eq + 1);
        if (value === undefined) {
          return refuse("ps", `\`${arg}\` without its value`, "linux");
        }
        const bad = valueRefusal(name, value);
        if (bad !== undefined) {
          return refuse("ps", bad, "linux");
        }
        index += eq === -1 ? 1 : 0;
      }
      continue;
    }
    if (arg === "" || arg === "-") {
      return refuse("ps", `\`${arg}\``, "linux");
    }
    const step = arg.startsWith("-")
      ? readCluster(LINUX_PS_UNIX, arg, next)
      : readCluster(LINUX_PS_BSD, arg, next, { joinedValues: false });
    if (step.refused !== undefined) {
      return refuse("ps", step.refused, "linux");
    }
    index += step.consumed;
  }
  return ALLOWED;
}

/** macOS top's options that are more than one letter, all taking a value. */
const DARWIN_TOP_WORDS = new Set(["-ncols", "-pid", "-stats", "-user"]);
const DARWIN_TOP: Letters = { ...flags("adeFfhRrSu"), ...values("cilnOosU") };

function classifyDarwinTop(argv: readonly string[]): ProcessListCall {
  let samples: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const next = argv[index + 1];
    if (DARWIN_TOP_WORDS.has(arg)) {
      if (next === undefined) {
        return refuse("top", `\`${arg}\` without its value`, "darwin");
      }
      index += 1;
      continue;
    }
    // top reads one option per argument, its value joined or the next one.
    const letter = arg.charAt(1);
    const kind = arg.startsWith("-") ? DARWIN_TOP[letter] : undefined;
    if (kind === undefined || (kind === "flag" && arg.length > 2)) {
      return refuse("top", `\`${arg}\``, "darwin");
    }
    if (kind === "value") {
      const value = arg.length > 2 ? arg.slice(2) : next;
      if (value === undefined) {
        return refuse("top", `\`${arg}\` without its value`, "darwin");
      }
      if (letter === "l") {
        samples = value;
      }
      index += arg.length > 2 ? 0 : 1;
    }
  }
  if (samples === undefined || !/^[1-9]\d*$/.test(samples)) {
    return refuse("top", "interactive mode", "darwin");
  }
  return ALLOWED;
}

const LINUX_TOP: Letters = { ...flags("1bcHhiOSsV"), ...values("dEenopUuw") };

function classifyLinuxTop(argv: readonly string[]): ProcessListCall {
  let batch = false;
  let iterations: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const next = argv[index + 1];
    if (!arg.startsWith("-") || arg.startsWith("--") || arg === "-") {
      return refuse("top", `\`${arg}\``, "linux");
    }
    const cluster = arg.slice(1);
    for (let at = 0; at < cluster.length; at++) {
      const letter = cluster.charAt(at);
      const kind = LINUX_TOP[letter];
      if (kind === undefined) {
        return refuse("top", `\`-${letter}\``, "linux");
      }
      batch ||= letter === "b";
      if (kind === "flag") {
        continue;
      }
      const rest = cluster.slice(at + 1);
      // `-w` takes its value only when one is given: `-w` or `-w 200`.
      const optional = letter === "w";
      const value =
        rest !== ""
          ? rest
          : optional
            ? next !== undefined && /^\d+$/.test(next)
              ? next
              : ""
            : next;
      if (value === undefined) {
        return refuse("top", `\`-${letter}\` without its value`, "linux");
      }
      if (letter === "n") {
        iterations = value;
      }
      index += rest === "" && value !== "" ? 1 : 0;
      break;
    }
  }
  if (!batch || iterations === undefined || !/^[1-9]\d*$/.test(iterations)) {
    return refuse("top", "interactive mode", "linux");
  }
  return ALLOWED;
}

/**
 * tasklist's options, which it reads after `/` or `-` in any case, and
 * whether each takes a value; `/m` takes one only when the next argument is
 * not an option. Not `/s`, `/u` or `/p`.
 */
const TASKLIST: Readonly<Record<string, "flag" | "value" | "optional">> = {
  "?": "flag",
  apps: "flag",
  fi: "value",
  fo: "value",
  m: "optional",
  nh: "flag",
  svc: "flag",
  v: "flag",
};
const TASKLIST_FORMATS = new Set(["csv", "list", "table"]);
const TASKLIST_OPTION = /^[/-]/;

function classifyTasklist(argv: readonly string[]): ProcessListCall {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const next = argv[index + 1];
    const name = TASKLIST_OPTION.test(arg)
      ? arg.slice(1).toLowerCase()
      : undefined;
    const kind =
      name !== undefined && Object.hasOwn(TASKLIST, name)
        ? TASKLIST[name]
        : undefined;
    if (kind === undefined) {
      return refuse("tasklist", `\`${arg}\``, "win32");
    }
    if (
      kind === "flag" ||
      (kind === "optional" &&
        (next === undefined || TASKLIST_OPTION.test(next)))
    ) {
      continue;
    }
    if (next === undefined) {
      return refuse("tasklist", `\`${arg}\` without its value`, "win32");
    }
    if (name === "fo" && !TASKLIST_FORMATS.has(next.toLowerCase())) {
      return refuse("tasklist", `the format \`${next}\``, "win32");
    }
    index += 1;
  }
  return ALLOWED;
}

/**
 * Whether `name` with `argv` (its arguments, without the program name) may
 * run outside the sandbox on `platform`. Pure: it reads only its arguments.
 */
export function classifyProcessList(
  name: ProcessLister,
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): ProcessListCall {
  if (name === "tasklist") {
    return platform === "win32"
      ? classifyTasklist(argv)
      : { allowed: false, reason: `${name}: not available here.` };
  }
  switch (platform) {
    case "darwin":
      return name === "ps" ? classifyDarwinPs(argv) : classifyDarwinTop(argv);
    case "linux":
      return name === "ps" ? classifyLinuxPs(argv) : classifyLinuxTop(argv);
    default:
      return { allowed: false, reason: `${name}: not available here.` };
  }
}

/** Write bits for the file's group and everyone else. */
const GROUP_OR_OTHER_WRITE = 0o022;

/**
 * Whether a system program is the computer's own: owned by root and
 * writable by no one else, so nothing running as the person replaced it.
 * On Windows the owner and mode `stat` reports say nothing about who may
 * write, so the program must sit in `System32`, which only an administrator
 * can change.
 */
export function systemOwned(
  file: string,
  {
    platform = process.platform,
    systemRoot = process.env.SystemRoot,
  }: { platform?: NodeJS.Platform; systemRoot?: string } = {},
): boolean {
  if (platform === "win32") {
    const win = nodePath.win32;
    return (
      systemRoot !== undefined &&
      win.dirname(win.resolve(file)).toLowerCase() ===
        win.join(systemRoot, "System32").toLowerCase()
    );
  }
  try {
    const stat = statSync(file);
    return stat.uid === 0 && (stat.mode & GROUP_OR_OTHER_WRITE) === 0;
  } catch {
    return false;
  }
}
