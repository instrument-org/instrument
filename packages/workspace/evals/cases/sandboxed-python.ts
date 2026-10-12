import path from "node:path";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * Python over a folder the chat reaches.
 *
 * `python` is the chat's virtualenv interpreter, held to the native sandbox,
 * and reads an attached folder in place, so a parse of a file there should
 * involve no copy into the chat's folder. A package goes in with `pip` and
 * the same `python` runs it. These check that a model takes the direct path,
 * since a unit test can show the folder is readable and nothing about
 * whether a model reads it there.
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

/** A copy of the attached file into the chat's folder is the step this work does not need. */
const neverCopiedTheMount: Assertion = {
  check: ({ sessions }) => {
    const copies = bashCommands(sessions).filter((command) =>
      /\b(?:cp|mv|rsync)\b[^|;&\n]*-eval-folders-[^/\s]*\/Data[^|;&\n]*(?:attachments|work|output)|\bcat\s+\S*-eval-folders-[^/\s]*\/Data\S*\s*>/.test(
        command,
      ),
    );
    return {
      evidence:
        copies.length === 0
          ? "No copy of the Data folder into the chat's folder"
          : `Copied the folder's file first: ${copies.join(" | ").slice(0, 300)}`,
      passed: copies.length === 0,
      text: "read the attached file where it is",
    };
  },
  text: "read the attached file where it is",
};

/** The interpreter, pointed at the attached folder. */
const ranPythonOnTheMount: Assertion = {
  check: ({ sessions }) => {
    const runs = bashCommands(sessions).filter(
      (command) =>
        /(?:^|[\s;&|(])python3?\s/.test(command) &&
        /-eval-folders-[^/\s]*\/Data/.test(command),
    );
    return {
      evidence:
        runs.length > 0
          ? `python ran against the folder ${runs.length}x: ${(runs[0] ?? "").slice(0, 200)}`
          : `No python command named the Data folder. Commands: ${bashCommands(sessions).join(" | ").slice(0, 400)}`,
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

/** The package went in and a Python ran it, under either name. */
const installedThePackageAndRanIt: Assertion = {
  check: ({ sessions }) => {
    const commands = bashCommands(sessions);
    const installed = pandasInstalledAt(commands);
    const ran = commands.findIndex(
      (command, index) =>
        // The same command counts when python comes after the install in it:
        // `pip install pandas && python -c ...`.
        (index > installed ||
          (index === installed && /install[^\n]*python3?\s/.test(command))) &&
        /(?:^|[\s;&|(])python3?\s/.test(command),
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

/** The script the prompt asked for ran as a file. */
const ranTheScriptFileWithPython: Assertion = {
  check: ({ sessions }) => {
    const runs = bashCommands(sessions).filter((command) =>
      /(?:^|[\s;&|(])python3?\s+(?:\S+\s+)*\S*count\.py\b/.test(command),
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
    folders: [{ path: DATA_FIXTURE }],
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
    folders: [{ path: DATA_FIXTURE }],
    name: "python-script-file-walks-the-mount",
    prompt:
      "Write a small Python script, save it as work/count.py, that walks my Data folder and prints each file's name with its line count and byte size. Run it and tell me what it printed.",
  }),
  defineEval({
    assertions: [
      replyContains("the total revenue", TOTAL_REVENUE),
      installedThePackageAndRanIt,
    ],
    folders: [{ path: DATA_FIXTURE }],
    name: "python-runs-a-package-once-installed",
    prompt:
      "Use pandas for this, not the csv module: load regional-sales.csv from my Data folder into a DataFrame, add a revenue column (units times unit_price), and tell me the total revenue for the year and the per-region totals, to the cent. Just the numbers in your reply; no files.",
  }),
];
