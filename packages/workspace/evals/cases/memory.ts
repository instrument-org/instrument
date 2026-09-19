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
 * - **One line.** Saving is said in a few words, not narrated.
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

export const MEMORY_EVALS = [
  defineEval({
    assertions: [savedAMemory, withoutATask],
    kind: "orchestrator",
    name: "memory-keeps-a-standing-fact",
    prompt:
      "Before we get into anything: I'm on Pacific time and I only take calls in the morning, so keep that in mind whenever you set something up for me.",
  }),
];
