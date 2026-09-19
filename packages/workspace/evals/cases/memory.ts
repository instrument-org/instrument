/**
 * Does the conversation keep what it is told about the user?
 *
 * Memory is a command in the conversation's shell and a section of its prompt,
 * so whether a model reaches for it when the user states a standing fact is a
 * property of the prompt and the model, not of code: it cannot be read off the
 * source, and it regresses silently. What these measure:
 *
 * - **A standing fact gets saved.** The user says something that will matter
 *   in a thread next week; the conversation saves it in the same reply.
 * - **It was a reply, not a task.** Keeping a fact is the conversation's own
 *   job, and nothing about the ask needs a task.
 * - **A preference inside a work ask is still saved.** Measured, this is the
 *   one that fails: a turn ends the moment a task is created, so a model that
 *   means to save after handing off never gets the step, and says it
 *   remembered something it did not. The save has to ride in the same command
 *   as the hand-off, which is what the prompt now shows.
 * - **It did not claim a memory it does not hold.** The failure above is only
 *   dangerous because the user is told it happened.
 *
 * **`--repeat` does not work on these.** Memory lives in the run's workspace,
 * which every trial of one run shares, so the second trial onward reads the
 * first trial's memory, correctly declines to save the same fact twice, and
 * fails an assertion that is asking the wrong question. Sample these by
 * running the case several times with a fresh `INSTRUMENT_EVAL_HOME` each
 * time.
 *
 * **What it measured, 2026-09-19, GLM 5.3 Flash at high effort.** The
 * standing-fact case passes about one run in three; Qwen3.8 27B passed it
 * first try. The two failures are the model's, not the mechanism's: it
 * printed `memory save ...` as text inside its reply, or it reasoned "Save
 * memory" and then called nothing. A third, rarer one is repaired in the
 * harness now: the command emitted as the tool's name rather than as a bash
 * call (`repair-shell-command-tool-call.ts`). All three end with the user
 * told a thing was remembered that was not, which is what the last assertion
 * is for. The conversation ships on a stronger model than this one.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

/** A command that keeps a memory, anchored the way the shell reads it. */
const SAVES_A_MEMORY = /(?:^|[\n;&|])\s*memory save\b/;

function bashParts(sessions: Session.WithMessagesAndParts[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        const output: string | undefined =
          part.state === "output-available" ? part.output.output : undefined;
        return command === undefined ? [] : [{ command, output }];
      }),
    ),
  );
}

function fail(text: string, evidence: string): AssertionResult {
  return { evidence, passed: false, text };
}

function pass(text: string, evidence: string): AssertionResult {
  return { evidence, passed: true, text };
}

const savedAMemory: Assertion = {
  check: ({ sessions }) => {
    const text = "saved what the user said to memory";
    const parts = bashParts(sessions);
    const saved = parts.filter(
      ({ command, output }) =>
        SAVES_A_MEMORY.test(command) &&
        /^(?:Saved|Replaced) "/m.test(output ?? ""),
    );
    return saved.length > 0
      ? pass(
          text,
          saved.map(({ output }) => output?.split("\n")[0]).join(" | "),
        )
      : fail(
          text,
          `${parts.length} commands, none a memory save: ${parts.map(({ command }) => command.split("\n")[0]).join(" | ")}`,
        );
  },
  text: "saved what the user said to memory",
};

const withoutATask: Assertion = {
  check: ({ sessions }) => {
    const text = "kept it without starting a task";
    const started = bashParts(sessions).filter(({ command }) =>
      /(?:^|[\n;&|])\s*task new\b/.test(command),
    );
    return started.length === 0
      ? pass(text, "no task")
      : fail(text, `started ${started.length} task(s) to remember a sentence`);
  },
  text: "kept it without starting a task",
};

/**
 * What the conversation told the user, before any task reported back: where a
 * claim of having remembered something would be.
 */
function firstReply(sessions: Session.WithMessagesAndParts[]): string {
  return (
    sessions
      .flatMap((session) =>
        session.messages
          .filter((message) => message.role === "assistant")
          .flatMap((message) =>
            message.parts.flatMap((part) =>
              part.type === "text" && part.text.trim() !== ""
                ? [part.text]
                : [],
            ),
          ),
      )
      .at(0)
      ?.trim() ?? ""
  );
}

/** Words a reply uses to say a thing is now remembered. */
const CLAIMS_A_MEMORY =
  /\b(?:noted|remember(?:ed|ing)?|saved|keep(?:ing)? that in mind|got it)\b/i;

const delegatedTheWork: Assertion = {
  check: ({ sessions }) => {
    const text = "handed the work to a task";
    const started = bashParts(sessions).filter(({ command }) =>
      /(?:^|[\n;&|])\s*task new\b/.test(command),
    );
    return started.length > 0
      ? pass(text, `${started.length} task(s)`)
      : fail(text, "no task, though the ask needed one");
  },
  text: "handed the work to a task",
};

/**
 * The lie this whole case exists for: a reply saying the preference is kept,
 * in a run where nothing was kept. Passing without a claim and without a save
 * would be honest but useless, so this rides beside `savedAMemory`.
 */
const didNotClaimWhatItDidNotSave: Assertion = {
  check: ({ sessions }) => {
    const text = "did not claim a memory it never saved";
    const saved = bashParts(sessions).some(({ command }) =>
      SAVES_A_MEMORY.test(command),
    );
    const reply = firstReply(sessions);
    return saved || !CLAIMS_A_MEMORY.test(reply)
      ? pass(
          text,
          saved ? "saved it" : `claimed nothing: ${JSON.stringify(reply)}`,
        )
      : fail(text, `said ${JSON.stringify(reply)} and saved nothing`);
  },
  text: "did not claim a memory it never saved",
};

export const MEMORY_EVALS = [
  defineEval({
    assertions: [savedAMemory, withoutATask],
    kind: "orchestrator",
    name: "memory-keeps-a-standing-fact",
    prompt:
      "Before we get into anything: I'm on Pacific time and I only take calls in the morning, so keep that in mind whenever you set something up for me.",
  }),

  defineEval({
    // The measured failure: the preference rides along with work, the turn
    // ends at the hand-off, and the save has nowhere to go unless it is in the
    // same command.
    assertions: [savedAMemory, delegatedTheWork, didNotClaimWhatItDidNotSave],
    kind: "orchestrator",
    name: "memory-saves-beside-a-hand-off",
    prompt:
      "Find me three electric kettles under $60 and put a short comparison in my Instrument folder. Also, for future reference, I only ever want decaf: any coffee or tea you suggest, now or later, has to be decaf.",
  }),
];
