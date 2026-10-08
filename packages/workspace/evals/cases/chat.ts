/**
 * Does the agent the user talks to answer in proportion to the ask?
 *
 * The chat is one agent: it does quick work itself and forks what is slow
 * (`task new`), and either way the user reads one conversation. Whether it
 * answers in a line, puts a result where the user said, and keeps one job
 * one job when the user changes it midway is a property of a prompt and a
 * model rather than of code, so none of it can be read off the source, and
 * all of it regresses silently.
 *
 * The asks are the ones a person actually typed into it, taken from real use.
 * What these measure, and why each is here:
 *
 * - **It answered from what it can see.** A question about a folder it has
 *   mounted is a command and a sentence, not a fork.
 * - **The deliverable is a file, named once.** A result lands where the user
 *   said, and the reply links it with a path that opens.
 * - **A change midway stays one job.** A correction or a wider ask goes into
 *   the work under way rather than starting it again.
 * - **A kind of thing starts with its skill.** A page, or a skill the user
 *   named, is loaded by the chat or by the fork doing the work.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getCurrentFileInfo } from "../../src/lib/get-file-info";
import { filesNamedIn } from "../../src/lib/parse-files-block";
import { taskDir } from "../../src/lib/task-dir-utils";
import { getWorkspaceConfig } from "../../src/lib/workspace-config";
import { MOUNT } from "../../src/mount-points";
import { WorkspaceFilePathSchema } from "../../src/schemas/paths";
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

type Context = Parameters<Assertion["check"]>[0];

const imageFixture = (name: string) =>
  fs
    .readFileSync(
      path.resolve(import.meta.dirname, "../fixtures/image-region", name),
    )
    .toString("base64");

/**
 * When this process started, which is near enough to when the run did. The
 * sandbox home outlives a run, so a file already in a folder says nothing
 * about the run that is being scored.
 */
const RUN_STARTED_AT = Date.now();

// ---------------------------------------------------------------------------
// Reading a conversation back out of a transcript
// ---------------------------------------------------------------------------

function assistantTexts(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" && part.text.trim() !== "" ? [part.text] : [],
        ),
      ),
  );
}

/** Every bash command the conversation ran, in order. */
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

/**
 * A command that starts a task, as opposed to one that merely mentions the
 * word. Anchored the way the turn-ending rule anchors it, so both agree on
 * what a fork is.
 */
const STARTS_A_TASK = /(?:^|[\n;&|])\s*task new\b/g;

// Counted per start rather than per command: a conversation that forks
// three tasks in one call, one heredoc after another, started three.
function taskNewCount(sessions: Session.WithMessagesAndParts[]): number {
  return bashCommands(sessions).reduce(
    (count, command) => count + [...command.matchAll(STARTS_A_TASK)].length,
    0,
  );
}

/** The chat's sessions and every fork's, the chat's first. */
async function treeSessions(
  ctx: Context,
): Promise<Session.WithMessagesAndParts[]> {
  const children = await ctx.childSessions();
  return [...ctx.sessions, ...children.flatMap((child) => child.sessions)];
}

/** Files under `dir` this run wrote, by host path. */
function recentFilesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter(
      (filePath) => fs.statSync(filePath).mtimeMs >= RUN_STARTED_AT - 1000,
    );
}

function fail(text: string, evidence: string): AssertionResult {
  return { evidence, passed: false, text };
}

function pass(text: string, evidence: string): AssertionResult {
  return { evidence, passed: true, text };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * The first reply is a line or two. The number is loose on purpose: what is
 * being caught is a paragraph where a sentence would do.
 */
function saidAtMost(chars: number): Assertion {
  const text = `the first reply was at most ${chars} characters`;
  return {
    check: ({ sessions }) => {
      const firstTurn = assistantTexts(sessions)[0] ?? "";
      return firstTurn.length <= chars
        ? pass(text, `${firstTurn.length} chars: ${JSON.stringify(firstTurn)}`)
        : fail(text, `${firstTurn.length} chars: ${JSON.stringify(firstTurn)}`);
    },
    text,
  };
}

const answeredWithoutATask: Assertion = {
  check: ({ sessions }) => {
    const text = "answered from what it could see, without starting a task";
    const count = taskNewCount(sessions);
    return count === 0
      ? pass(text, `no task; ${assistantTexts(sessions).length} replies`)
      : fail(text, `started ${count} task(s) for a question it could answer`);
  },
  text: "answered from what it could see, without starting a task",
};

/**
 * One job stays one job: a change to it goes into the work under way, done
 * by the chat or by the one fork carrying it, rather than into a second fork
 * that starts the work again.
 */
function startedAtMost(count: number): Assertion {
  const text = `started at most ${count} task${count === 1 ? "" : "s"}`;
  return {
    check: ({ sessions }) => {
      const started = taskNewCount(sessions);
      const commands = bashCommands(sessions);
      return started <= count
        ? pass(text, `${started} \`task new\` in ${commands.length} commands`)
        : fail(
            text,
            `${started} \`task new\`: ${commands
              .map((command) => command.split("\n")[0])
              .join(" | ")}`,
          );
    },
    text,
  };
}

/** The chat or a fork of it loaded the skill, by its plain or source-qualified name. */
function loadedSkill(name: string): Assertion {
  const text = `loaded the ${name} skill`;
  return {
    check: async (ctx) => {
      const loads = (await treeSessions(ctx)).flatMap((session) =>
        session.messages.flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "tool-load_skill" &&
            typeof part.input?.name === "string"
              ? [part.input.name]
              : [],
          ),
        ),
      );
      return loads.some(
        (loaded) => loaded === name || loaded.endsWith(`:${name}`),
      )
        ? pass(text, loads.join(", "))
        : fail(text, loads.length > 0 ? loads.join(", ") : "no skill loaded");
    },
    text,
  };
}

function landedInAppFolder(slug: string, file: string): Assertion {
  const text = `${file} is in ${slug}'s app folder`;
  return {
    check: () => {
      const target = path.join(getWorkspaceConfig().appsDir, slug, file);
      return fs.existsSync(target)
        ? pass(text, `${fs.statSync(target).size} bytes`)
        : fail(text, `nothing at ${MOUNT.apps}/${slug}/${file}`);
    },
    text,
  };
}

/**
 * The conversation's last reply links at least one file, and every file it
 * links resolves to one on disk: a fence naming a path nobody can open is the
 * failure the fence's paths exist to prevent.
 */
const linkedAFileThatExists: Assertion = {
  check: async ({ sessions, taskId }) => {
    const text = "the conversation's reply links files that exist";
    const named = filesNamedIn(assistantTexts(sessions).at(-1) ?? "");
    if (named.length === 0) {
      return fail(text, "the last reply names no file in a fence");
    }
    const resolved = await Promise.all(
      named.map(async (name) => {
        const filePath = WorkspaceFilePathSchema.safeParse(name);
        const info = filePath.success
          ? await getCurrentFileInfo({ filePath: filePath.data, taskId })
          : undefined;
        return { exists: info?.isOk() ?? false, name };
      }),
    );
    const evidence = resolved
      .map(({ exists, name }) => `${name} -> ${exists ? "exists" : "missing"}`)
      .join("; ");
    return resolved.every(({ exists }) => exists)
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "the conversation's reply links files that exist",
};

/** The conversation passed the answer on rather than asking for the file again. */
function repliedWith(phrase: string): Assertion {
  const text = `the conversation's reply said "${phrase}"`;
  return {
    check: ({ sessions }) => {
      const last = assistantTexts(sessions).at(-1) ?? "";
      return last.toLowerCase().includes(phrase.toLowerCase())
        ? pass(text, JSON.stringify(last))
        : fail(text, JSON.stringify(last));
    },
    text,
  };
}

function wroteInto(folder: string): Assertion {
  const text = `a file landed in the user's ${folder} folder`;
  return {
    check: () => {
      const dir = path.join(os.homedir(), folder);
      const written = recentFilesUnder(dir);
      return written.length > 0
        ? pass(text, written.join(", "))
        : fail(text, `nothing this run wrote is in ${dir}`);
    },
    text,
  };
}

/** Each kind of document was made, in the user's folders or the chat's own. */
function madeDocuments(extensions: string[]): Assertion {
  const text = `made a ${extensions.join(", ")} file`;
  return {
    check: async ({ childSessions, taskId }) => {
      const children = await childSessions();
      const written = [
        os.homedir(),
        taskDir(taskId),
        ...children.map((child) => taskDir(child.taskId)),
      ].flatMap((dir) => recentFilesUnder(dir));
      const missing = extensions.filter(
        (extension) => !written.some((file) => file.endsWith(extension)),
      );
      return missing.length === 0
        ? pass(text, written.map((file) => path.basename(file)).join(", "))
        : fail(text, `no ${missing.join(", ")} written`);
    },
    text,
  };
}

/** The essay at `file` in the Instrument folder came out at most `words` long. */
function essayAtMost(file: string, words: number): Assertion {
  const text = `${file} is at most ${words} words`;
  return {
    check: () => {
      const target = path.join(os.homedir(), "Documents", "Instrument", file);
      if (!fs.existsSync(target)) {
        return fail(text, `no ${file} in the Instrument folder`);
      }
      const count = fs
        .readFileSync(target, "utf8")
        .split(/\s+/)
        .filter(Boolean).length;
      return count <= words
        ? pass(text, `${count} words`)
        : fail(text, `${count} words`);
    },
    text,
  };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export const CHAT_EVALS = [
  defineEval({
    assertions: [wroteInto("Documents/Instrument"), linkedAFileThatExists],
    kind: "chat",
    name: "chat-one-file",
    prompt:
      "Make me a one-page markdown summary of what a CDN is, and put it in my Instrument folder.",
  }),

  defineEval({
    // The ask that took a minute and three quarters of thinking before anything
    // appeared on screen, in the words it was typed in. A fork per document
    // or all three in the chat: either way all three have to exist.
    assertions: [madeDocuments([".docx", ".pptx", ".xlsx"])],
    kind: "chat",
    name: "chat-three-documents",
    prompt:
      "I want to do a quick document creation test. Can you spawn a few tasks to make a Word doc and a PowerPoint and a Excel sheet, just kind of for an example company with kind of a fake environment set up so that it can show how it does and I can understand if it's working well. Thank you.",
  }),

  defineEval({
    // Its folder is mounted, so this is a `ls` and a sentence.
    assertions: [answeredWithoutATask, saidAtMost(400)],
    kind: "chat",
    name: "chat-answers-a-question",
    prompt: "How many files are in my Instrument folder?",
  }),

  defineEval({
    // A model the user names is theirs to pick: the agent runs on the one
    // they picked, so it says where the picker is rather than starting the
    // work on a model nobody asked for.
    assertions: [answeredWithoutATask, saidAtMost(400)],
    kind: "chat",
    name: "chat-asked-for-a-model",
    prompt:
      "Write a two-line poem about beans with Claude Opus, to beans.md in my Instrument folder.",
  }),

  defineEval({
    // A folder other than the workspace one, which the chat reaches only once
    // it is added (`task folder --add`, or the user's pick).
    assertions: [wroteInto("Downloads"), linkedAFileThatExists],
    kind: "chat",
    name: "chat-writes-into-downloads",
    prompt:
      "Write me a one-page markdown summary of what a CDN is and put it in my Downloads folder.",
  }),

  defineEval({
    // A correction while the essay is under way changes that essay, whether
    // the chat is writing it or a fork is.
    assertions: [startedAtMost(1), essayAtMost("pelican-heraldry.md", 700)],
    followUps: ["Actually make that 400 words, and skip the sources."],
    kind: "chat",
    name: "chat-corrects-the-work-under-way",
    prompt:
      "Write a 1500-word essay on the pelican in heraldry, with sources, to pelican-heraldry.md in my Instrument folder.",
  }),

  defineEval({
    // A follow-up that widens the work to a folder nobody has added yet. The
    // folder is added where the work stands (`task folder --add` reaches a
    // running fork too); a second fork for the copies pays for the first
    // one's context again.
    assertions: [startedAtMost(1), wroteInto("Downloads")],
    followUps: ["Put copies of those in my Downloads folder as well."],
    kind: "chat",
    name: "chat-widens-to-a-folder",
    prompt:
      "Write two short markdown notes, one on what a CDN is and one on what DNS is, one file each in my Instrument folder.",
  }),

  defineEval({
    // A file bound for an app's folder, which the agent writes like any other.
    apps: [{ name: "Beacon", slug: "beacon" }],
    assertions: [landedInAppFolder("beacon", "icon.png")],
    kind: "chat",
    name: "chat-places-a-file-in-an-app-folder",
    prompt:
      "Make a simple square PNG icon for my Beacon app, a lighthouse on a dark blue background, and put it in Beacon's app folder as icon.png.",
  }),

  defineEval({
    // The user asked for the kind of thing a skill makes.
    assertions: [loadedSkill("create-page")],
    kind: "chat",
    name: "chat-asks-for-a-page",
    prompt:
      "Make me a page comparing the three best-known static site generators, in my Instrument folder.",
  }),

  defineEval({
    // A screenshot pasted into the conversation, in the words it was asked
    // with: the answer is what only the picture says.
    assertions: [repliedWith("pull")],
    files: [
      { content: imageFixture("legible-status.png"), filename: "status.png" },
    ],
    kind: "chat",
    name: "chat-reads-a-sent-file",
    prompt: "wat this",
  }),

  defineEval({
    // A skill the user picked with / in the composer arrives as a mention.
    assertions: [loadedSkill("color")],
    kind: "chat",
    name: "chat-loads-a-mentioned-skill",
    prompt:
      "[$color](skill:color) use this to pick a five-color palette for a small coffee shop brand, and put it in my Instrument folder.",
  }),

  defineEval({
    // The same ask typed by hand, with no mention part behind it.
    assertions: [loadedSkill("color")],
    kind: "chat",
    name: "chat-loads-a-typed-skill",
    prompt:
      "/color use this to pick a five-color palette for a small coffee shop brand, and put it in my Instrument folder.",
  }),
];
