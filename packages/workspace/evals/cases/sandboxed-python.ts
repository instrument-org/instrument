import path from "node:path";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * The two Pythons, as the agent has to tell them apart.
 *
 * `python` runs inside the sandbox and reads an attached folder in place, so
 * a standard-library parse of a mounted file should involve no copy into the
 * task. A package runs in the task's virtualenv, which `python` goes to on its
 * own once the package is installed, and the route there is the message the
 * sandboxed interpreter prints when an import fails. The virtualenv cannot see
 * the mount, so a package run on a mounted file also has to be copied in, and
 * the refusal says so. These check that a model takes the direct path when it
 * exists and follows the signposts when it does not, since a unit test can
 * show a message is printed and nothing about whether it is read.
 */
const DATA_FIXTURE = path.resolve(import.meta.dirname, "../fixtures/Data");

/** Total revenue in the fixture, units times unit price over every row. */
const TOTAL_REVENUE = 742_370.74;

/** Every bash command the task ran, in order. */
function bashCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        return command === undefined ? [] : [command];
      }),
    ),
  );
}

function conversationText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

/** A number the reply must carry, with or without thousands separators. */
function replyContains(label: string, value: number): Assertion {
  const text = `reply states ${label}`;
  const plain = value.toFixed(2);
  const grouped = value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const rounded = Math.round(value).toLocaleString("en-US");
  return {
    check: ({ sessions }) => {
      const reply = conversationText(sessions);
      const found = [plain, grouped, rounded].find((form) =>
        reply.includes(form),
      );
      return {
        evidence:
          found === undefined
            ? `Neither ${plain} nor ${grouped} appears. Reply: ${reply.slice(-400)}`
            : `Found ${found}`,
        passed: found !== undefined,
        text,
      };
    },
    text,
  };
}

/** A copy of the mounted file into the task is the step this work no longer needs. */
const neverCopiedTheMount: Assertion = {
  check: ({ sessions }) => {
    const copies = bashCommands(sessions).filter((command) =>
      /\b(?:cp|mv|rsync|cat)\b[^|;&]*\/mnt\/Data[^|;&]*(?:attachments|work|output|>)/.test(
        command,
      ),
    );
    return {
      evidence:
        copies.length === 0
          ? "No copy of /mnt/Data into the task"
          : `Copied the mount first: ${copies.join(" | ").slice(0, 300)}`,
      passed: copies.length === 0,
      text: "read the attached file where it is",
    };
  },
  text: "read the attached file where it is",
};

/** The sandboxed interpreter, pointed at the mount. */
const ranPythonOnTheMount: Assertion = {
  check: ({ sessions }) => {
    const runs = bashCommands(sessions).filter(
      (command) =>
        /(?:^|[\s;&|(])python3?\s/.test(command) &&
        !command.includes("python-native") &&
        command.includes("/mnt/Data"),
    );
    return {
      evidence:
        runs.length > 0
          ? `python ran against the mount ${runs.length}x: ${(runs[0] ?? "").slice(0, 200)}`
          : `No python command named /mnt/Data. Commands: ${bashCommands(sessions).join(" | ").slice(0, 400)}`,
      passed: runs.length > 0,
      text: "ran python on the mounted file",
    };
  },
  text: "ran python on the mounted file",
};

/** Where the package went in, or -1. */
function pandasInstalledAt(commands: string[]): number {
  return commands.findIndex((command) =>
    /\b(?:pip3?|uv pip)\s+install\s[^|;&]*pandas/.test(command),
  );
}

/** After the import failed, the package went in and a Python ran it, under either name. */
const installedThePackageAndRanIt: Assertion = {
  check: ({ sessions }) => {
    const commands = bashCommands(sessions);
    const installed = pandasInstalledAt(commands);
    const ran = commands.findIndex(
      (command, index) =>
        // The same command counts when python comes after the install in it:
        // `pip install pandas && python -c ...`.
        (index > installed ||
          (index === installed &&
            /install[^\n]*python(?:3|-native)?\s/.test(command))) &&
        /(?:^|[\s;&|(])python(?:3|-native)?\s/.test(command),
    );
    const passed = installed !== -1 && ran !== -1;
    return {
      evidence: passed
        ? `pip install at command ${installed + 1}, python at ${ran + 1} of ${commands.length}: ${(commands[ran] ?? "").slice(0, 120)}`
        : `install ${installed === -1 ? "never happened" : `at ${installed + 1}`}, python ${ran === -1 ? "never ran after it" : `at ${ran + 1}`}. Commands: ${commands.join(" | ").slice(0, 500)}`,
      passed,
      text: "installed the package and ran it",
    };
  },
  text: "installed the package and ran it",
};

/** The message says once what to do; a model that loops on the failing import did not read it. */
const didNotRetryTheSandboxedImport: Assertion = {
  check: ({ sessions }) => {
    const commands = bashCommands(sessions);
    const installed = pandasInstalledAt(commands);
    const failing = commands.filter(
      (command, index) =>
        (installed === -1 || index < installed) &&
        /(?:^|[\s;&|(])python3?\s/.test(command) &&
        command.includes("pandas"),
    );
    return {
      evidence: `${failing.length} python command(s) imported pandas before it was installed`,
      passed: failing.length <= 2,
      text: "did not keep retrying the sandboxed import",
    };
  },
  text: "did not keep retrying the sandboxed import",
};

/** The script the prompt asked for ran as a file, under the sandboxed interpreter. */
const ranTheScriptFileWithPython: Assertion = {
  check: ({ sessions }) => {
    const runs = bashCommands(sessions).filter(
      (command) =>
        /(?:^|[\s;&|(])python3?\s+(?:\S+\s+)*\S*count\.py\b/.test(command) &&
        !command.includes("python-native"),
    );
    return {
      evidence:
        runs.length > 0
          ? `ran ${runs.length}x: ${(runs[0] ?? "").slice(0, 200)}`
          : `Never ran count.py with python. Commands: ${bashCommands(sessions).join(" | ").slice(0, 400)}`,
      passed: runs.length > 0,
      text: "ran the script file with python",
    };
  },
  text: "ran the script file with python",
};

export const SANDBOXED_PYTHON_EVALS = [
  defineEval({
    assertions: [
      replyContains("the total revenue", TOTAL_REVENUE),
      neverCopiedTheMount,
      ranPythonOnTheMount,
    ],
    folders: [{ access: "read-only", path: DATA_FIXTURE }],
    name: "python-reads-the-mount-in-place",
    prompt:
      "regional-sales.csv in my Data folder has a year of sales by region and month, with units and a unit price per row. Revenue is units times unit price. Tell me total revenue for the year and revenue per region, to the cent. Just the numbers in your reply; no files.",
  }),
  defineEval({
    // A script file rather than inline code: the path the script is run by
    // is what names it in a traceback and sets sys.path, and the walk has to
    // reach the mount from inside a file that lives in the task.
    assertions: [
      replyContains("the fixture's line count", 49),
      neverCopiedTheMount,
      ranTheScriptFileWithPython,
    ],
    folders: [{ access: "read-only", path: DATA_FIXTURE }],
    name: "python-script-file-walks-the-mount",
    prompt:
      "Write a small Python script, save it as work/count.py, that walks my Data folder and prints each file's name with its line count and byte size. Run it and tell me what it printed.",
  }),
  defineEval({
    assertions: [
      replyContains("the total revenue", TOTAL_REVENUE),
      installedThePackageAndRanIt,
      didNotRetryTheSandboxedImport,
    ],
    folders: [{ access: "read-only", path: DATA_FIXTURE }],
    name: "python-runs-a-package-once-installed",
    prompt:
      "Use pandas for this, not the csv module: load regional-sales.csv from my Data folder into a DataFrame, add a revenue column (units times unit_price), and tell me the total revenue for the year and the per-region totals, to the cent. Just the numbers in your reply; no files.",
  }),
];
