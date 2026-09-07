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
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

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
const STARTS_A_TASK = /(?:^|[\n;&|])\s*task new\b/;

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

function taskNewCount(sessions: Session.WithMessagesAndParts[]): number {
  return bashCommands(sessions).filter((command) => STARTS_A_TASK.test(command))
    .length;
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
      childRepliedInAtMost(400),
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
    // The mirror case. Its folder is mounted, so this is a `ls` and a sentence.
    assertions: [answeredWithoutATask, saidAtMost(400)],
    kind: "orchestrator",
    name: "orchestrator-answers-a-question",
    prompt: "How many files are in my Instrument folder?",
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
];
