/**
 * Does the conversation go on sensibly after a question is answered?
 *
 * A `choose` can come back four ways: one of the choices, the user's own
 * words, a skip, and any of those with a note. The last three are easy for a
 * model to mishandle in ways no unit test sees: asking the same question
 * again after a skip, ignoring a note, or treating an answer it did not offer
 * as a mistake. Each case asks for something small enough that the
 * conversation does it itself, tells it to ask first, and answers one way.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

const PROMPT =
  "Write me a one-line tagline for my bakery. Ask me which tone I want first, as a choice.";

function chooseParts(sessions: Session.WithMessagesAndParts[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.filter((part) => part.type === "tool-choose"),
    ),
  );
}

/** What the conversation said after the last question was answered. */
function replyAfterAnswer(sessions: Session.WithMessagesAndParts[]): string {
  const texts: string[] = [];
  let answered = false;
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "tool-choose") {
          answered = part.state === "output-available";
          texts.length = 0;
        } else if (
          answered &&
          message.role === "assistant" &&
          part.type === "text"
        ) {
          texts.push(part.text);
        }
      }
    }
  }
  return texts.join("\n").trim();
}

const ASKED_ONCE: Assertion = {
  check: ({ sessions }) => {
    const parts = chooseParts(sessions);
    return {
      evidence: parts
        .map(
          (part) =>
            `${part.input?.question ?? ""} [${(part.input?.choices ?? []).join(" | ")}]`,
        )
        .join("\n"),
      passed: parts.length === 1,
      text: "asked exactly one question",
    };
  },
  text: "asked exactly one question",
};

const NO_ESCAPE_CHOICES: Assertion = {
  check: ({ sessions }) => {
    const choices = chooseParts(sessions).flatMap(
      (part) => part.input?.choices ?? [],
    );
    const escapes = choices.filter((choice) =>
      /\b(?:other|skip|something else|none of|surprise me|your call)\b/i.test(
        choice ?? "",
      ),
    );
    return {
      evidence: escapes.join(", ") || choices.join(", "),
      passed: escapes.length === 0,
      text: "wrote no Other or Skip choice of its own",
    };
  },
  text: "wrote no Other or Skip choice of its own",
};

const REPLIED: Assertion = {
  check: ({ sessions }) => {
    const reply = replyAfterAnswer(sessions);
    return {
      evidence: reply.slice(0, 400),
      passed: reply.length > 0,
      text: "replied after the answer",
    };
  },
  text: "replied after the answer",
};

function mentions(word: string): Assertion {
  const text = `the reply after the answer mentions "${word}"`;
  return {
    check: ({ sessions }) => {
      const reply = replyAfterAnswer(sessions);
      return {
        evidence: reply.slice(0, 400),
        passed: reply.toLowerCase().includes(word.toLowerCase()),
        text,
      };
    },
    text,
  };
}

export const QUESTIONS_EVALS = [
  defineEval({
    answers: [
      (input) => ({
        note: "Mention our sourdough.",
        selectedChoice: input.choices[0] ?? "",
      }),
    ],
    assertions: [ASKED_ONCE, NO_ESCAPE_CHOICES, REPLIED, mentions("sourdough")],
    kind: "orchestrator",
    name: "questions-choice-with-note",
    prompt: PROMPT,
  }),
  defineEval({
    answers: [{ selectedChoice: "Deadpan, like a bored museum guard" }],
    assertions: [ASKED_ONCE, NO_ESCAPE_CHOICES, REPLIED],
    kind: "orchestrator",
    name: "questions-own-answer",
    prompt: PROMPT,
  }),
  defineEval({
    answers: [{ declined: true }],
    assertions: [ASKED_ONCE, NO_ESCAPE_CHOICES, REPLIED],
    kind: "orchestrator",
    name: "questions-skipped",
    prompt: PROMPT,
  }),
  defineEval({
    answers: [{ declined: true, note: "You pick. We're in Portland." }],
    assertions: [ASKED_ONCE, NO_ESCAPE_CHOICES, REPLIED, mentions("Portland")],
    kind: "orchestrator",
    name: "questions-skipped-with-note",
    prompt: PROMPT,
  }),
];
