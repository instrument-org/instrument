import fs from "node:fs";
import path from "node:path";

import { outputFolderPath } from "../../src/lib/chat/output-folder";
import { workDir } from "../../src/lib/work-dir";
import { getWorkspaceSkillsDir } from "../../src/lib/workspace-skills-dir";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * Where the agent puts things, now that its shell names its folders
 * (`INSTRUMENT_WORK`, `INSTRUMENT_ATTACHMENTS`, `INSTRUMENT_OUTPUT`) and its
 * work folder is no package of its own: finished work goes in the output
 * folder, in a folder named for the job; what the person sent is read where
 * it lies; a package goes in where the job is, in a `package.json` there
 * (pnpm makes one where there is none). A unit test shows the variables are
 * set and pnpm makes the manifest; only a model shows whether it goes where
 * the prompt says.
 */

/** What the agent wrote to the person, every reply of it. */
function replyText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

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

/** Every file under `root`, by its path relative to it. */
function filesUnder(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.relative(root, path.join(entry.parentPath, entry.name)),
      );
  } catch {
    return [];
  }
}

const deliversIntoTheOutputFolder: Assertion = {
  check: () => {
    // The eval home's output folder holds what other runs left, so the CSV
    // counts by what is in it: ten squares, ending at 100.
    const placed = filesUnder(outputFolderPath()).filter(
      (file) =>
        file.endsWith(".csv") &&
        file.includes(path.sep) &&
        /\b10\s*,\s*100\b/.test(
          fs.readFileSync(path.join(outputFolderPath(), file), "utf8"),
        ),
    );
    return {
      evidence:
        placed.length > 0
          ? `Placed ${placed.join(", ")}`
          : `No CSV of the squares in a folder of ${outputFolderPath()}`,
      passed: placed.length > 0,
      text: "Puts the finished CSV in the output folder, in a folder for the job",
    };
  },
  text: "Puts the finished CSV in the output folder, in a folder for the job",
};

const namesFilesInFull: Assertion = {
  check: ({ sessions }) => {
    const reply = replyText(sessions);
    const variable = /\$\{?INSTRUMENT_/.test(reply);
    return {
      evidence: variable
        ? `Named a file by a variable: ${reply.slice(-300)}`
        : "Named its files by their paths",
      passed: !variable,
      text: "Names files to the person by their paths, not a shell variable",
    };
  },
  text: "Names files to the person by their paths, not a shell variable",
};

/**
 * The prompt names the workspace's skills folder only as
 * `$INSTRUMENT_WORKSPACE_SKILLS`, and the file tools read no variable, so a
 * skill written with one would land in a folder named after it.
 */
const savesTheSkillInTheWorkspace: Assertion = {
  check: ({ chatId }) => {
    const skillsDir = getWorkspaceSkillsDir();
    const skills = filesUnder(skillsDir).filter(
      (file) =>
        path.basename(file) === "SKILL.md" &&
        /meeting/i.test(fs.readFileSync(path.join(skillsDir, file), "utf8")),
    );
    // A path that starts with a variable reads as relative, so a skill
    // written that way lands in the work folder.
    const misplaced = filesUnder(workDir(chatId)).filter((file) =>
      file.includes("INSTRUMENT_"),
    );
    return {
      evidence:
        misplaced.length > 0
          ? `Wrote under a variable's name: ${misplaced.join(", ")}`
          : skills.length > 0
            ? `Saved ${skills.join(", ")}`
            : `No meeting-notes SKILL.md in ${skillsDir}`,
      passed: skills.length > 0 && misplaced.length === 0,
      text: "Saves the new skill in the workspace's skills folder, by its path",
    };
  },
  text: "Saves the new skill in the workspace's skills folder, by its path",
};

/** What the person sends: a CSV whose amount column adds up to `AMOUNT_TOTAL`. */
const EXPENSES = {
  content: Buffer.from(
    "date,item,amount\n2026-10-01,coffee,12.50\n2026-10-02,parking,7.25\n2026-10-03,books,30.00\n2026-10-04,stamp,0.25\n",
  ).toString("base64"),
  filename: "expenses.csv",
};

/** The amount column of the attached CSV adds up to this. */
const AMOUNT_TOTAL = "50.00";

const totalsTheAttachment: Assertion = {
  check: ({ sessions }) => {
    const reply = replyText(sessions);
    const found = /\b50(?:\.00?)?\b/.test(reply);
    return {
      evidence: found
        ? "Reported the total"
        : `No ${AMOUNT_TOTAL} in: ${reply.slice(-300)}`,
      passed: found,
      text: "Totals the amount column of the file the person sent",
    };
  },
  text: "Totals the amount column of the file the person sent",
};

const readsTheAttachmentInPlace: Assertion = {
  check: ({ sessions }) => {
    const copies = bashCommands(sessions).filter((command) =>
      /\b(?:cp|mv|rsync)\b[^|;&\n]*(?:INSTRUMENT_ATTACHMENTS|attachments\/)/.test(
        command,
      ),
    );
    return {
      evidence:
        copies.length === 0
          ? "Read the file where it lies"
          : `Copied it first: ${copies.join(" | ")}`,
      passed: copies.length === 0,
      text: "Reads what the person sent where it lies, with no copy",
    };
  },
  text: "Reads what the person sent where it lies, with no copy",
};

/** What every tool call in the run gave back, as text. */
function toolResults(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        [
          "output" in part ? JSON.stringify(part.output ?? "") : "",
          "errorText" in part ? String(part.errorText ?? "") : "",
        ].filter(Boolean),
      ),
    ),
  );
}

/**
 * The record folder around what the person sent is the app's own data, so
 * listing it is refused with the note that stops the agent probing. Without
 * that refusal the case says nothing about the turn after it.
 */
const metTheAppDataNote: Assertion = {
  check: ({ sessions }) => {
    const met = toolResults(sessions).some((result) =>
      result.includes("own data"),
    );
    return {
      evidence: met
        ? "Was told the record folder is Instrument's own data"
        : "Never met the app's own data, so the follow-up tested nothing",
      passed: met,
      text: "Is refused the folder around what the person sent first",
    };
  },
  text: "Is refused the folder around what the person sent first",
};

const installsWherePnpmMakesAManifest: Assertion = {
  check: ({ chatId }) => {
    const root = workDir(chatId);
    const manifests = filesUnder(root).filter(
      (file) =>
        path.basename(file) === "package.json" &&
        !file.split(path.sep).includes("node_modules") &&
        fs.readFileSync(path.join(root, file), "utf8").includes('"slugify"'),
    );
    return {
      evidence:
        manifests.length > 0
          ? `slugify is in ${manifests.join(", ")}`
          : "No package.json in the work folder names slugify",
      passed: manifests.length > 0,
      text: "Installs the package with pnpm, in a package.json in its work folder",
    };
  },
  text: "Installs the package with pnpm, in a package.json in its work folder",
};

const reportsTheSlug: Assertion = {
  check: ({ sessions }) => {
    const reply = replyText(sessions);
    const found = /hello-world-again/i.test(reply);
    return {
      evidence: found
        ? "Reported the slug"
        : `No slug in: ${reply.slice(-300)}`,
      passed: found,
      text: "Reports the slug the package made",
    };
  },
  text: "Reports the slug the package made",
};

export const WORK_FOLDER_EVALS = [
  defineEval({
    assertions: [deliversIntoTheOutputFolder, namesFilesInFull],
    name: "work-folder-output",
    prompt:
      "Write a Python script that makes a CSV of the numbers 1 to 10 and their squares, and give me the CSV.",
  }),
  defineEval({
    assertions: [totalsTheAttachment, readsTheAttachmentInPlace],
    files: [EXPENSES],
    name: "work-folder-attachment",
    prompt:
      "Use a Python script to total the amount column of the CSV I sent, and tell me the total.",
  }),
  // After the app's own data is refused, what the person sent still reads:
  // it sits inside that data, and the note says it stays open.
  defineEval({
    assertions: [metTheAppDataNote, totalsTheAttachment],
    files: [EXPENSES],
    followUps: [
      "Okay. Now use a shell command to total the amount column of the CSV I sent, and tell me the total.",
    ],
    name: "work-folder-attachment-after-refusal",
    prompt: 'Run ls -la "$INSTRUMENT_ATTACHMENTS/.." and tell me what it says.',
  }),
  defineEval({
    assertions: [savesTheSkillInTheWorkspace],
    name: "work-folder-workspace-skill",
    prompt:
      "Make me a skill that turns raw meeting notes into decisions and action items, and save it so I can use it in my other chats.",
  }),
  defineEval({
    assertions: [installsWherePnpmMakesAManifest, reportsTheSlug],
    name: "work-folder-pnpm",
    prompt:
      "Install the npm package slugify and use it in a Node script to turn the title 'Hello World Again' into a lowercase URL slug. Tell me the slug.",
  }),
];
