/**
 * Does the conversation stay a conversation?
 *
 * The agent the user talks to is meant to be the one part of the app that is
 * never busy: it answers in a line, hands anything that touches the world to a
 * task, and reports what came back without saying it twice. Every one of those
 * is a property of a prompt and a model rather than of code, so none of them
 * can be read off the source, and all of them regress silently.
 *
 * The asks are the ones a person actually typed into it, taken from the first
 * two days of real use, because scripted delegation scenarios hid the problem
 * that real use found: told to judge whether a job is one step or several, a
 * model answers the question it was asked and does the work itself.
 *
 * What these measure, and why each is here:
 *
 * - **It delegated at all.** The failure that started this: one task in
 *   twenty-one turns.
 * - **It said one line and stopped.** A conversation that narrates its hand-off
 *   twice, or explains the app, is one the user reads instead of using.
 * - **It did not do the work itself.** No file written from the conversation,
 *   no page driven, when the ask plainly needs a task.
 * - **It answered from what it can see.** The mirror case, and the more
 *   valuable half: a question about a folder it has mounted is not a task.
 * - **The deliverable is a file, named once.** The whole point of a task is
 *   that its answer is a thing on disk. A report pasted into the chat by the
 *   task and then restated by the conversation is the same words paid for three
 *   times.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { mountsOf } from "../../src/lib/orchestrator/mount-paths";
import { filesNamedIn } from "../../src/lib/parse-files-block";
import { taskDir } from "../../src/lib/task-dir-utils";
import { MOUNT } from "../../src/mount-points";
import { type Session } from "../../src/schemas/session";
import { TaskIdSchema } from "../../src/schemas/task-id";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

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
 * A command that starts a task, as opposed to one that merely mentions the word.
 * Anchored the way the turn-ending rule anchors it, so both agree on what a
 * hand-off is.
 */
const STARTS_A_TASK = /(?:^|[\n;&|])\s*task new\b/g;

/**
 * Every task the conversation started, as the flags it passed and the brief
 * it wrote: the `task new` line, then the heredoc's body up to its
 * terminator, or to the command's end when the model left the terminator
 * off, which bash accepts too. A brief passed as a quoted argument instead is
 * the rest of the line, so a conversation that skipped the heredoc is still
 * scored on what it said.
 */
function briefsOf(
  sessions: Session.WithMessagesAndParts[],
): { brief: string; flags: string }[] {
  return bashCommands(sessions).flatMap((command) => {
    const lines = command.split("\n");
    const briefs: { brief: string; flags: string }[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const start = /^\s*(?:[;&|]\s*)?task new\b(.*)$/.exec(line);
      if (!start) {
        continue;
      }
      const flags = start[1] ?? "";
      const heredoc = /<<-?\s*(['"]?)(\w+)\1/.exec(flags);
      if (!heredoc) {
        briefs.push({ brief: flags, flags });
        continue;
      }
      const terminator = heredoc[2];
      const body: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor]?.trim() !== terminator) {
        body.push(lines[cursor] ?? "");
        cursor += 1;
      }
      briefs.push({
        brief: body.join("\n"),
        flags: flags.slice(0, heredoc.index),
      });
      index = cursor;
    }
    return briefs;
  });
}

function delegated(atLeast: number): Assertion {
  const text =
    atLeast === 1
      ? "handed the work to a task"
      : `started at least ${atLeast} tasks`;
  return {
    check: ({ sessions }) => {
      const count = taskNewCount(sessions);
      const commands = bashCommands(sessions);
      return count >= atLeast
        ? pass(text, `${count} \`task new\` in ${commands.length} commands`)
        : fail(
            text,
            `${count} \`task new\` in ${commands.length} commands: ${commands.map((command) => command.split("\n")[0]).join(" | ")}`,
          );
    },
    text,
  };
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

// Counted per start rather than per command: a conversation that fans out
// three tasks in one call, one heredoc after another, started three.
function taskNewCount(sessions: Session.WithMessagesAndParts[]): number {
  return bashCommands(sessions).reduce(
    (count, command) => count + [...command.matchAll(STARTS_A_TASK)].length,
    0,
  );
}

/**
 * The conversation has no tool that writes a file's contents, so doing the work
 * itself shows up as the shell commands that move one around, or as a heredoc
 * into a file. `cp` of a finished deliverable is explicitly its job and does not
 * count.
 */
const DID_THE_WORK_ITSELF =
  /(?:^|[\n;&|])\s*(?:printf|echo|sed|tee|cat)\b[^\n]*>|>\s*['"]?\/mnt\//;

const didNotDoTheWorkItself: Assertion = {
  check: ({ sessions }) => {
    const text = "did not write the deliverable itself";
    const offending = bashCommands(sessions).filter((command) =>
      DID_THE_WORK_ITSELF.test(command),
    );
    return offending.length === 0
      ? pass(text, "no command in the conversation wrote a file's contents")
      : fail(text, offending.join(" | "));
  },
  text: "did not write the deliverable itself",
};

/**
 * One line, then the hand-off. The number is loose on purpose: what is being
 * caught is a conversation that writes a paragraph of plan, or announces the
 * same task twice, not one that adds a clause.
 */
function saidAtMost(chars: number): Assertion {
  const text = `said at most ${chars} characters before the task reported`;
  return {
    check: ({ sessions }) => {
      // Everything up to the first wake, which is where the conversation is
      // only allowed its one line.
      const said = assistantTexts(sessions);
      const firstTurn = said[0] ?? "";
      return firstTurn.length <= chars
        ? pass(text, `${firstTurn.length} chars: ${JSON.stringify(firstTurn)}`)
        : fail(text, `${firstTurn.length} chars: ${JSON.stringify(firstTurn)}`);
    },
    text,
  };
}

/**
 * A task revised where it stands rather than replaced. `task folder --add` and
 * `task app --add` are the moves being scored; `task tab` and `task model` are
 * the same act on the task's other settings, and any of them followed by a
 * `send` is the shape.
 */
const REVISED_A_TASK = /(?:^|[\n;&|])\s*task (?:app|folder|tab|model)\b/;

/** A `task new` carrying `--model`, or a `task model` moving one. */
const NAMED_A_MODEL = /(?:^|[\n;&|])\s*task (?:new\b[^\n]*--model|model\b)/;

/**
 * How many tasks the conversation started, where more than one is the failure:
 * the second one is the first one's context bought twice.
 */
function startedExactly(count: number): Assertion {
  const text = `started exactly ${count} task${count === 1 ? "" : "s"}`;
  return {
    check: ({ sessions }) => {
      const started = taskNewCount(sessions);
      const commands = bashCommands(sessions);
      return started === count
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

/**
 * Every task ran on the conversation's own model: no `task new` named one
 * and no `task model` moved one. The user picks the model for the
 * conversation, and a task that quietly runs on another is the way an
 * unapproved model gets picked without anyone choosing it.
 */
const ranOnTheConversationsModel: Assertion = {
  check: ({ sessions }) => {
    const text = "ran every task on the conversation's own model";
    const named = bashCommands(sessions).filter((command) =>
      NAMED_A_MODEL.test(command),
    );
    return named.length === 0
      ? pass(text, `no --model in ${bashCommands(sessions).length} commands`)
      : fail(text, named.map((command) => command.split("\n")[0]).join(" | "));
  },
  text: "ran every task on the conversation's own model",
};

const revisedATaskInPlace: Assertion = {
  check: ({ sessions }) => {
    const text = "changed a running task's setup rather than starting another";
    const revisions = bashCommands(sessions).filter((command) =>
      REVISED_A_TASK.test(command),
    );
    return revisions.length > 0
      ? pass(text, revisions.join(" | "))
      : fail(
          text,
          `no \`task folder\`, \`task tab\` or \`task model\` in ${bashCommands(sessions).length} commands`,
        );
  },
  text: "changed a running task's setup rather than starting another",
};

/**
 * The brief said what and not how. A skill named for a question, a tool
 * named as the way to find something, sites listed to check: each is a step
 * the task follows to the letter, the wrong ones included, and a question
 * that was one search becomes a survey. The exception is a skill the user
 * asked for by the thing it makes, which the page case scores the other way.
 */
const PRESCRIBES_HOW =
  /\bskills?\b|load_skill|agent-browser|\bbrowser\b|web_search|\bsearch (?:the web|online) (?:with|using|via)\b|\b(?:reddit|discord|twitter|downdetector)\b/i;

const briefedWhatNotHow: Assertion = {
  check: ({ sessions }) => {
    const text = "the brief named no skill, tool, or site to use";
    const briefs = briefsOf(sessions);
    if (briefs.length === 0) {
      return fail(text, "no task was started");
    }
    const offending = briefs.filter(({ brief }) => PRESCRIBES_HOW.test(brief));
    return offending.length === 0
      ? pass(text, briefs.map(({ brief }) => JSON.stringify(brief)).join(" | "))
      : fail(
          text,
          offending
            .map(
              ({ brief }) =>
                `${PRESCRIBES_HOW.exec(brief)?.[0] ?? ""}: ${JSON.stringify(brief)}`,
            )
            .join(" | "),
        );
  },
  text: "the brief named no skill, tool, or site to use",
};

/**
 * A brief that names a path, a file type, or the fence is a brief asking for
 * a file, which a question does not want: the answer travels in the task's
 * last message whole.
 */
const ASKS_FOR_A_FILE =
  /\/mnt\/|\/tasks\/|\.(?:md|html?|pdf|docx|pptx|xlsx|csv|txt|json)\b|files? fence|\b(?:write|save|put|create) [^.]{0,40}(?:file|report|document)\b/i;

const briefedWithoutAFile: Assertion = {
  check: ({ sessions }) => {
    const text = "the brief asked for an answer, not a file";
    const briefs = briefsOf(sessions);
    if (briefs.length === 0) {
      return fail(text, "no task was started");
    }
    const offending = briefs.filter(({ brief }) => ASKS_FOR_A_FILE.test(brief));
    return offending.length === 0
      ? pass(text, briefs.map(({ brief }) => JSON.stringify(brief)).join(" | "))
      : fail(
          text,
          offending
            .map(
              ({ brief }) =>
                `${ASKS_FOR_A_FILE.exec(brief)?.[0] ?? ""}: ${JSON.stringify(brief)}`,
            )
            .join(" | "),
        );
  },
  text: "the brief asked for an answer, not a file",
};

/** A brief the size of the ask: a question is a sentence or two. */
function briefAtMost(chars: number): Assertion {
  const text = `each brief was at most ${chars} characters`;
  return {
    check: ({ sessions }) => {
      const briefs = briefsOf(sessions);
      if (briefs.length === 0) {
        return fail(text, "no task was started");
      }
      const evidence = briefs
        .map(({ brief }) => `${brief.length} chars: ${JSON.stringify(brief)}`)
        .join(" | ");
      return briefs.every(({ brief }) => brief.length <= chars)
        ? pass(text, evidence)
        : fail(text, evidence);
    },
    text,
  };
}

/**
 * The task inherits the conversation's effort unless there is a reason not
 * to, and a quick question is no reason to raise it: that is minutes the
 * user waits. Lowering it for a lookup is the prompt's own suggestion.
 */
const didNotRaiseEffort: Assertion = {
  check: ({ sessions }) => {
    const text = "did not raise --effort for a quick question";
    const briefs = briefsOf(sessions);
    if (briefs.length === 0) {
      return fail(text, "no task was started");
    }
    const raised = briefs.filter(({ flags }) =>
      /--effort\s+(?:high|max)\b/.test(flags),
    );
    return raised.length === 0
      ? pass(text, "no --effort high or max on any task new")
      : fail(text, raised.map(({ flags }) => flags.trim()).join(" | "));
  },
  text: "did not raise --effort for a quick question",
};

/** The one skill a brief is meant to name: the kind of thing the user asked for. */
function briefNamedSkill(name: string): Assertion {
  const text = `the brief named the ${name} skill`;
  return {
    check: ({ sessions }) => {
      const briefs = briefsOf(sessions);
      if (briefs.length === 0) {
        return fail(text, "no task was started");
      }
      const naming = briefs.filter(({ brief }) => brief.includes(name));
      return naming.length > 0
        ? pass(
            text,
            naming.map(({ brief }) => JSON.stringify(brief)).join(" | "),
          )
        : fail(
            text,
            briefs.map(({ brief }) => JSON.stringify(brief)).join(" | "),
          );
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

/** A task loaded the skill, by its plain or source-qualified name. */
function aTaskLoadedSkill(name: string): Assertion {
  const text = `a task loaded the ${name} skill`;
  const loads = (child: { sessions: Session.WithMessagesAndParts[] }) =>
    child.sessions.some((session) =>
      session.messages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === "tool-load_skill" &&
            typeof part.input?.name === "string" &&
            (part.input.name === name || part.input.name.endsWith(`:${name}`)),
        ),
      ),
    );
  return {
    check: async ({ childSessions }) => {
      const children = await childSessions();
      if (children.length === 0) {
        return fail(text, "no task was started");
      }
      const evidence = children
        .map(
          (child) =>
            `${child.title}: ${loads(child) ? "loaded" : "did not load"}`,
        )
        .join("; ");
      return children.some(loads) ? pass(text, evidence) : fail(text, evidence);
    },
    text,
  };
}

/**
 * The hand-off channel is the child's last assistant text, cut at 400
 * characters, so a child that writes its report into the chat spends the
 * conversation's context on words the conversation is told not to repeat. What
 * is measured is the child's own last words, since that is what travels.
 */
function childRepliedInAtMost(chars: number): Assertion {
  const text = `each task's last word was at most ${chars} characters`;
  return {
    check: async ({ childSessions }) => {
      const children = await childSessions();
      if (children.length === 0) {
        return fail(text, "no task was started, so nothing reported back");
      }
      const lasts = children.map((child) => ({
        last: assistantTexts(child.sessions).at(-1) ?? "",
        title: child.title,
      }));
      const tooLong = lasts.filter((one) => one.last.length > chars);
      const evidence = lasts
        .map((one) => `${one.title}: ${one.last.length} chars`)
        .join("; ");
      return tooLong.length === 0 ? pass(text, evidence) : fail(text, evidence);
    },
    text,
  };
}

/** Did the tasks actually produce files, or only words? */
const tasksWroteFiles: Assertion = {
  check: async ({ childSessions }) => {
    const text = "every task wrote at least one file";
    const children = await childSessions();
    if (children.length === 0) {
      return fail(text, "no task was started");
    }
    const wrote = children.map((child) => ({
      count: child.sessions.reduce(
        (total, session) =>
          total +
          session.messages.reduce(
            (perMessage, message) =>
              perMessage +
              message.parts.filter(
                (part) =>
                  part.type === "tool-write_file" ||
                  part.type === "tool-edit_file",
              ).length,
            0,
          ),
        0,
      ),
      title: child.title,
    }));
    const evidence = wrote
      .map((one) => `${one.title}: ${one.count} file writes`)
      .join("; ");
    return wrote.every((one) => one.count > 0)
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "every task wrote at least one file",
};

/**
 * Did anything land in the folder the ask named?
 *
 * Read off the disk rather than out of a transcript, because a transcript is
 * exactly what cannot answer it: the conversation and the task mount the same
 * folder under names of their own, and a task briefed in a path its own mounts
 * do not have writes nothing, writes into its own scratch instead, or has to
 * spend turns working out what it was really given -- and reports that it is
 * done in every one of those cases.
 */
/**
 * The receipt rule: a task's last message ends with a files fence naming what
 * it made, which is the one thing about its files the orchestrator is handed.
 */
const tasksNamedTheirFiles: Assertion = {
  check: async ({ childSessions }) => {
    const text = "every task named what it made in a files fence";
    const children = await childSessions();
    if (children.length === 0) {
      return fail(text, "no task was started");
    }
    const receipts = children.map((child) => ({
      named: filesNamedIn(assistantTexts(child.sessions).at(-1) ?? ""),
      title: child.title,
    }));
    const evidence = receipts
      .map((one) => `${one.title}: ${one.named.join(", ") || "(no fence)"}`)
      .join("; ");
    return receipts.every((one) => one.named.length > 0)
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "every task named what it made in a files fence",
};

/**
 * The conversation's last reply links at least one file, and every file it
 * links is on disk: a fence naming a path nobody can open is the failure the
 * receipt's paths, translated on the way in, exist to prevent.
 */
const linkedAFileThatExists: Assertion = {
  check: async ({ sessions, taskId }) => {
    const text = "the conversation's reply links files that exist";
    const named = filesNamedIn(assistantTexts(sessions).at(-1) ?? "");
    if (named.length === 0) {
      return fail(text, "the last reply names no file in a fence");
    }
    const mounts = await mountsOf(taskId);
    const resolved = named.map((name) => ({
      host: hostPathOf(name, mounts),
      name,
    }));
    const evidence = resolved
      .map(
        ({ host, name }) =>
          `${name} -> ${host === undefined ? "(unresolved)" : fs.existsSync(host) ? "exists" : "missing"}`,
      )
      .join("; ");
    return resolved.every(
      ({ host }) => host !== undefined && fs.existsSync(host),
    )
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "the conversation's reply links files that exist",
};

/** The task saw the file: its last word carries what only the file says. */
function aTaskAnsweredWith(phrase: string): Assertion {
  const text = `a task's last word said "${phrase}"`;
  return {
    check: async ({ childSessions }) => {
      const children = await childSessions();
      if (children.length === 0) {
        return fail(text, "no task was started");
      }
      const lasts = children.map((child) => ({
        last: assistantTexts(child.sessions).at(-1) ?? "",
        title: child.title,
      }));
      const saying = lasts.filter((one) =>
        one.last.toLowerCase().includes(phrase.toLowerCase()),
      );
      const evidence = lasts
        .map((one) => `${one.title}: ${JSON.stringify(one.last)}`)
        .join("; ");
      return saying.length > 0 ? pass(text, evidence) : fail(text, evidence);
    },
    text,
  };
}

/**
 * A file the user sent reaches a task only as a copy handed over on the
 * command: the conversation's own folder is one no task can see, so a brief
 * that names the file where the conversation has it names a file the task
 * cannot find.
 */
function handedTheFileToATask(filename: string): Assertion {
  const text = `handed ${filename} to a task with --file`;
  const handed = new RegExp(
    String.raw`(?:^|[\n;&|])\s*task (?:new|send)\b[^\n]*--file[= ]['"]?[^\s'"]*${filename.replaceAll(".", String.raw`\.`)}`,
  );
  return {
    check: ({ sessions }) => {
      const commands = bashCommands(sessions);
      const carrying = commands.filter((command) => handed.test(command));
      return carrying.length > 0
        ? pass(
            text,
            carrying.map((command) => command.split("\n")[0]).join(" | "),
          )
        : fail(
            text,
            `no --file in ${commands.length} commands: ${commands.map((command) => command.split("\n")[0]).join(" | ")}`,
          );
    },
    text,
  };
}

/** A path as the conversation writes it, on disk; undefined where no mount covers it. */
function hostPathOf(
  named: string,
  mounts: Awaited<ReturnType<typeof mountsOf>>,
): string | undefined {
  const tasksPrefix = `${MOUNT.tasks}/`;
  if (named.startsWith(tasksPrefix)) {
    const [id, ...rest] = named.slice(tasksPrefix.length).split("/");
    const parsed = TaskIdSchema.safeParse(id);
    return parsed.success
      ? path.join(taskDir(parsed.data), ...rest)
      : undefined;
  }
  const mountPrefix = `${MOUNT.attachedFolders}/`;
  if (!named.startsWith(mountPrefix)) {
    return undefined;
  }
  const [name, ...rest] = named.slice(mountPrefix.length).split("/");
  const mount = Object.values(mounts).find(
    (folder) => folder.mountName === name,
  );
  return mount ? path.join(mount.path, ...rest) : undefined;
}

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
      const entries = fs.readdirSync(dir, {
        recursive: true,
        withFileTypes: true,
      });
      const written = entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name))
        .filter(
          (filePath) => fs.statSync(filePath).mtimeMs >= RUN_STARTED_AT - 1000,
        );
      return written.length > 0
        ? pass(text, written.join(", "))
        : fail(text, `nothing this run wrote is in ${dir}`);
    },
    text,
  };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_EVALS = [
  defineEval({
    assertions: [
      delegated(1),
      didNotDoTheWorkItself,
      saidAtMost(280),
      tasksWroteFiles,
      tasksNamedTheirFiles,
      linkedAFileThatExists,
      childRepliedInAtMost(600),
    ],
    kind: "orchestrator",
    name: "orchestrator-one-file",
    prompt:
      "Make me a one-page markdown summary of what a CDN is, and put it in my Instrument folder.",
  }),

  defineEval({
    // The ask that took a minute and three quarters of thinking before anything
    // appeared on screen, in the words it was typed in.
    assertions: [delegated(3), didNotDoTheWorkItself, saidAtMost(400)],
    kind: "orchestrator",
    name: "orchestrator-three-documents",
    prompt:
      "I want to do a quick document creation test. Can you spawn a few tasks to make a Word doc and a PowerPoint and a Excel sheet, just kind of for an example company with kind of a fake environment set up so that it can show how it does and I can understand if it's working well. Thank you.",
  }),

  defineEval({
    // "one from each of the newest models" is one task per model, which is the
    // fan-out the conversation gets wrong most often: one task told to compare.
    assertions: [delegated(2), didNotDoTheWorkItself],
    kind: "orchestrator",
    name: "orchestrator-one-task-per-model",
    prompt:
      "Write a two-line poem about beans with two different models, one file each in my Instrument folder, named for the model.",
  }),

  defineEval({
    // The mirror case: nothing about the ask names a model, so the task runs
    // on the conversation's. The ask is one whose "strength" a conversation
    // might reach for a bigger model over, which is the pick nobody made.
    assertions: [delegated(1), ranOnTheConversationsModel],
    kind: "orchestrator",
    name: "orchestrator-runs-on-its-own-model",
    prompt:
      "Write a careful, well-researched 600-word explainer on how DNS resolution works, to dns.md in my Instrument folder.",
  }),

  defineEval({
    // The mirror case. Its folder is mounted, so this is a `ls` and a sentence.
    assertions: [answeredWithoutATask, saidAtMost(400)],
    kind: "orchestrator",
    name: "orchestrator-answers-a-question",
    prompt: "How many files are in my Instrument folder?",
  }),

  defineEval({
    // The only case that names a folder other than the workspace one, which is
    // the one folder both sides happen to call the same thing. Everything the
    // conversation has to get right about handing a folder over is here: the
    // mount it passes, the access it asks for, and the path it writes into the
    // brief for a task that reaches that folder by another.
    assertions: [
      delegated(1),
      didNotDoTheWorkItself,
      tasksWroteFiles,
      tasksNamedTheirFiles,
      linkedAFileThatExists,
      wroteInto("Downloads"),
    ],
    kind: "orchestrator",
    name: "orchestrator-hands-over-a-folder",
    prompt:
      "Write me a one-page markdown summary of what a CDN is and put it in my Downloads folder.",
  }),

  defineEval({
    // A correction mid-flight goes into the running task, not into a new one.
    assertions: [delegated(1), didNotDoTheWorkItself],
    followUps: ["Actually make that 400 words, and skip the sources."],
    kind: "orchestrator",
    name: "orchestrator-steers-a-running-task",
    prompt:
      "Write a 1500-word essay on the pelican in heraldry, with sources, to pelican-heraldry.md in my Instrument folder.",
  }),

  defineEval({
    // A follow-up that widens the work to a folder the running task was never
    // handed. The task holds everything already worked out, so the move is to
    // give it the folder where it stands and say so; starting a second task
    // throws that away and pays for it again. The conversation cannot do it
    // itself either, since the home mount is read-only as a whole for it.
    assertions: [
      delegated(1),
      startedExactly(1),
      revisedATaskInPlace,
      didNotDoTheWorkItself,
    ],
    followUps: ["Put copies of those in my Downloads folder as well."],
    kind: "orchestrator",
    name: "orchestrator-widens-a-running-task",
    prompt:
      "Write two short markdown notes, one on what a CDN is and one on what DNS is, one file each in my Instrument folder.",
  }),

  defineEval({
    // The same widening, on the setting a task cannot ask about itself. It has
    // no way in to an app it was not handed and no way to request one, so it
    // stops; the whole of the fix is handing it the app and saying carry on.
    // The app is connected before the run, which is the state the conversation
    // is in once the user has signed in.
    apps: [{ name: "Beacon", slug: "beacon" }],
    assertions: [
      delegated(1),
      startedExactly(1),
      revisedATaskInPlace,
      didNotDoTheWorkItself,
    ],
    followUps: [
      "Good. Now file each of the points it made as its own issue in our Beacon tracker.",
    ],
    kind: "orchestrator",
    name: "orchestrator-hands-over-an-app",
    prompt:
      "Write me a short markdown note in my Instrument folder about what makes a good bug report.",
  }),

  // A question about the world, in the words one was asked in. The failure
  // measured in real use: a brief that named the browser skill, listed the
  // sites to check, asked for a findings report on disk, and raised the
  // effort, which turned a one-search question into four minutes and five
  // million tokens of survey. The task has no search here, so what is scored
  // is the brief alone.
  defineEval({
    assertions: [
      delegated(1),
      didNotDoTheWorkItself,
      saidAtMost(280),
      briefedWhatNotHow,
      briefedWithoutAFile,
      briefAtMost(500),
      didNotRaiseEffort,
    ],
    kind: "orchestrator",
    name: "orchestrator-quick-question-outage",
    prompt:
      "are folks having issues getting disconnected from wow forever today",
  }),

  defineEval({
    // The same shape with a smaller answer: a number and a word.
    assertions: [
      delegated(1),
      didNotDoTheWorkItself,
      saidAtMost(280),
      briefedWhatNotHow,
      briefedWithoutAFile,
      briefAtMost(400),
      didNotRaiseEffort,
    ],
    kind: "orchestrator",
    name: "orchestrator-quick-question-weather",
    prompt: "what's the weather in Nashville right now",
  }),

  defineEval({
    // The other side of the same rule: the user asked for the kind of thing a
    // skill makes, and the brief names that skill and nothing about how.
    assertions: [
      delegated(1),
      didNotDoTheWorkItself,
      saidAtMost(280),
      briefNamedSkill("create-page"),
    ],
    kind: "orchestrator",
    name: "orchestrator-asks-for-a-page",
    prompt:
      "Make me a page comparing the three best-known static site generators, in my Instrument folder.",
  }),

  defineEval({
    // A screenshot pasted into the conversation, in the words it was asked
    // with. The conversation cannot look at a picture and no task can see
    // its folder, so the only road is handing the file over on the command;
    // a brief that names the file where the conversation has it sends the
    // task looking for a file that is not there, and it asks for it again.
    assertions: [
      delegated(1),
      handedTheFileToATask("status.png"),
      aTaskAnsweredWith("image pull backoff"),
      repliedWith("pull"),
    ],
    files: [
      { content: imageFixture("legible-status.png"), filename: "status.png" },
    ],
    kind: "orchestrator",
    name: "orchestrator-hands-over-a-sent-file",
    prompt: "wat this",
  }),
  defineEval({
    // A skill the user picked with / in the composer arrives as a mention the
    // conversation cannot load itself; the brief carries it to the task.
    assertions: [
      delegated(1),
      briefNamedSkill("color"),
      aTaskLoadedSkill("color"),
    ],
    kind: "orchestrator",
    name: "orchestrator-passes-on-a-mentioned-skill",
    prompt:
      "[$color](skill:color) use this to pick a five-color palette for a small coffee shop brand, and put it in my Instrument folder.",
  }),

  defineEval({
    // The same ask typed by hand, with no mention part behind it.
    assertions: [
      delegated(1),
      briefNamedSkill("color"),
      aTaskLoadedSkill("color"),
    ],
    kind: "orchestrator",
    name: "orchestrator-passes-on-a-typed-skill",
    prompt:
      "/color use this to pick a five-color palette for a small coffee shop brand, and put it in my Instrument folder.",
  }),
];
