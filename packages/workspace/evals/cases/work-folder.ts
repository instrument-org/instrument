import fs from "node:fs";
import path from "node:path";

import { finishedWorkFolder } from "../../src/lib/chat/output-folder";
import { chatDir, chatOwnFolder } from "../../src/lib/record-folders";
import { workDir } from "../../src/lib/work-dir";
import { getWorkspaceConfig } from "../../src/lib/workspace-config";
import { workspaceLayout } from "../../src/lib/workspace-layout";
import { getWorkspaceSkillsDir } from "../../src/lib/workspace-skills-dir";
import { CHATS_FOLDER_NAME } from "../../src/constants";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * Where the agent puts things, now that its shell names its folders
 * (`INSTRUMENT_WORK`, `INSTRUMENT_OUTPUT`) and its work folder is no
 * package of its own: finished work goes in the conversation's own folder
 * by its own name; what the person sent is read where it lies; a package
 * goes in where the job is, in a `package.json` there (pnpm makes one
 * where there is none). A unit test shows the variables are set and pnpm
 * makes the manifest; only a model shows whether it goes where the prompt
 * says.
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

const deliversIntoTheChatsOwnFolder: Assertion = {
  check: ({ chatId }) => {
    // Where the shell's `$INSTRUMENT_OUTPUT` pointed, worked out the same
    // way: the chat's own folder under `Chats/`, named for the
    // conversation. The prompt asks for the finished file in it by its own
    // name, so a folder of its own in there is a miss rather than a pass.
    const folder = finishedWorkFolder(chatOwnFolder(chatDir(chatId)));
    const squares = filesUnder(folder).filter(
      (file) =>
        file.endsWith(".csv") &&
        /\b10\s*,\s*100\b/.test(
          fs.readFileSync(path.join(folder, file), "utf8"),
        ),
    );
    const placed = squares.filter((file) => !file.includes(path.sep));
    const inASubfolder = squares.filter((file) => file.includes(path.sep));
    return {
      evidence:
        placed.length > 0
          ? `Placed ${placed.join(", ")} in ${folder}`
          : inASubfolder.length > 0
            ? `Put it in a folder of its own: ${inASubfolder.join(", ")}`
            : `No CSV of the squares in ${folder}`,
      passed: placed.length > 0,
      text: "Puts the finished CSV in the conversation's own folder, by its own name",
    };
  },
  text: "Puts the finished CSV in the conversation's own folder, by its own name",
};

/**
 * A folder the person asked for by name, with no place given, made inside
 * the conversation's own folder. The same name anywhere else under the
 * Instrument folder is a miss: beside the conversation's folder under
 * `Chats/` it reads as another conversation.
 */
function makesTheNamedFolderInside(name: RegExp, label: string): Assertion {
  const text = `Makes the ${label} folder inside the conversation's own folder`;
  return {
    check: ({ chatId }) => {
      const folder = finishedWorkFolder(chatOwnFolder(chatDir(chatId)));
      const inside = fs
        .readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && name.test(entry.name))
        .filter(
          (entry) => filesUnder(path.join(folder, entry.name)).length > 0,
        );
      return {
        evidence:
          inside.length > 0
            ? `Made ${inside.map((entry) => entry.name).join(", ")} in ${folder}`
            : `No ${label} folder with files in ${folder}`,
        passed: inside.length > 0,
        text,
      };
    },
    text,
  };
}

/**
 * Nothing in `Chats/` but conversations' own folders. Every chat of the run
 * names its own folder in its settings, so anything else there is a folder
 * an agent made beside them; it counts against this run when its own tool
 * calls named it, since every case in a run shares the workspace.
 */
export const leavesChatsToConversations: Assertion = {
  check: ({ sessions }) => {
    const named = sessions
      .flatMap((session) => session.messages)
      .flatMap((message) => message.parts)
      .filter((part) => part.type.startsWith("tool-"))
      .map((part) => JSON.stringify(part))
      .join("\n");
    const { rootDir } = getWorkspaceConfig();
    const records = workspaceLayout(rootDir).chatsDir;
    // Which folder is a chat's own is the records' to say, as the app reads it.
    const own = new Set(
      fs.readdirSync(records).flatMap((id) => {
        const folder = chatOwnFolder(path.join(records, id));
        return folder === undefined ? [] : [path.basename(folder)];
      }),
    );
    const stray = fs.readdirSync(path.join(rootDir, CHATS_FOLDER_NAME)).filter(
      (entry) =>
        !entry.startsWith(".") &&
        !own.has(entry) &&
        // A whole path segment, so "…and" is not found inside "…and 3".
        [`/${entry}/`, `/${entry}"`].some((segment) => named.includes(segment)),
    );
    return {
      evidence:
        stray.length > 0
          ? `Made beside the conversations' folders: ${stray.join(", ")}`
          : "Only conversations' folders in Chats/",
      passed: stray.length === 0,
      text: "Leaves Chats/ to the conversations' own folders",
    };
  },
  text: "Leaves Chats/ to the conversations' own folders",
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
      /\b(?:cp|mv|rsync)\b[^|;&\n]*attachments\//.test(command),
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
  // A folder asked for by name, with nowhere said: it goes inside the
  // conversation's own folder, never beside it under Chats/.
  defineEval({
    assertions: [
      makesTheNamedFolderInside(/trip\s*ideas/i, "Trip ideas"),
      leavesChatsToConversations,
    ],
    name: "work-folder-named-folder",
    prompt:
      "Make a folder called Trip ideas with a short note in it for each of three weekend trips from Chicago.",
  }),
  defineEval({
    assertions: [
      makesTheNamedFolderInside(/poems/i, "Poems"),
      leavesChatsToConversations,
    ],
    name: "work-folder-named-folder-of-files",
    prompt:
      "Write three short poems about autumn, one per file, and put them in a folder named Poems.",
  }),
  defineEval({
    assertions: [
      deliversIntoTheChatsOwnFolder,
      namesFilesInFull,
      leavesChatsToConversations,
    ],
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
  // After the app's own data is refused, the work carries on: the folder
  // holding every chat's work folder is the app's data, and the note that
  // says so is what stops the agent probing for a way in.
  defineEval({
    assertions: [metTheAppDataNote, totalsTheAttachment],
    files: [EXPENSES],
    followUps: [
      "Okay. Now use a shell command to total the amount column of the CSV I sent, and tell me the total.",
    ],
    name: "work-folder-attachment-after-refusal",
    prompt: 'Run ls -la "$INSTRUMENT_WORK/.." and tell me what it says.',
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
