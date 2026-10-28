/**
 * Does the conversation go on sensibly after a question is answered?
 *
 * A `choose` can come back four ways: one of the choices, the user's own
 * words, a skip, and any of those with a note. The last three are easy for a
 * model to mishandle in ways no unit test sees: asking the same question
 * again after a skip, ignoring a note, or treating an answer it did not offer
 * as a mistake. Each case asks for something small enough that the
 * conversation does it itself, tells it to ask first, and answers one way.
 *
 * The call returns at once and the answer arrives later as a message of its
 * own, so each case also scores what the agent did in between: a tagline
 * written before the tone was picked is the work done without the answer.
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

/**
 * What the conversation said after the last question, split at its answer:
 * the words between asking and the answer arriving, and the words after.
 */
function repliesAroundAnswer(sessions: Session.WithMessagesAndParts[]): {
  after: string;
  before: string;
} {
  const before: string[] = [];
  const after: string[] = [];
  let answered = false;
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "tool-choose") {
          answered = false;
          before.length = 0;
          after.length = 0;
        } else if (part.type === "data-questionAnswer") {
          answered = true;
        } else if (message.role === "assistant" && part.type === "text") {
          (answered ? after : before).push(part.text);
        }
      }
    }
  }
  return { after: after.join("\n").trim(), before: before.join("\n").trim() };
}

function replyAfterAnswer(sessions: Session.WithMessagesAndParts[]): string {
  return repliesAroundAnswer(sessions).after;
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

/**
 * Nothing the answer decides was written before it arrived. A tagline is a
 * quoted line, so a quote before the answer is the work done without it.
 */
const WAITED_FOR_ANSWER: Assertion = {
  check: ({ sessions }) => {
    const { before } = repliesAroundAnswer(sessions);
    return {
      evidence: before.slice(0, 400) || "(nothing)",
      passed: !/["“”]/.test(before),
      text: "wrote no tagline before the answer arrived",
    };
  },
  text: "wrote no tagline before the answer arrived",
};

/**
 * The card is the question: the words between asking and the answer carry
 * the conversation on rather than asking it a second time.
 */
const LEFT_THE_ASKING_TO_THE_CARD: Assertion = {
  check: ({ sessions }) => {
    const { before } = repliesAroundAnswer(sessions);
    return {
      evidence: before.slice(0, 400) || "(nothing)",
      passed: !before.includes("?"),
      text: "left the asking to the card",
    };
  },
  text: "left the asking to the card",
};

/**
 * Nothing at all between asking and the answer: a line written after the
 * card can land after the person has already answered it, telling them to
 * confirm what they just confirmed.
 */
const SAID_NOTHING_AFTER_ASKING: Assertion = {
  check: ({ sessions }) => {
    const { before } = repliesAroundAnswer(sessions);
    return {
      evidence: before.slice(0, 400) || "(nothing)",
      passed: before === "",
      text: "said nothing between asking and the answer",
    };
  },
  text: "said nothing between asking and the answer",
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
    assertions: [
      ASKED_ONCE,
      NO_ESCAPE_CHOICES,
      WAITED_FOR_ANSWER,
      LEFT_THE_ASKING_TO_THE_CARD,
      SAID_NOTHING_AFTER_ASKING,
      REPLIED,
      mentions("sourdough"),
    ],
    kind: "chat",
    name: "questions-choice-with-note",
    prompt: PROMPT,
  }),
  defineEval({
    answers: [{ selectedChoice: "Deadpan, like a bored museum guard" }],
    assertions: [
      ASKED_ONCE,
      NO_ESCAPE_CHOICES,
      WAITED_FOR_ANSWER,
      LEFT_THE_ASKING_TO_THE_CARD,
      SAID_NOTHING_AFTER_ASKING,
      REPLIED,
    ],
    kind: "chat",
    name: "questions-own-answer",
    prompt: PROMPT,
  }),
  defineEval({
    answers: [{ declined: true }],
    assertions: [
      ASKED_ONCE,
      NO_ESCAPE_CHOICES,
      WAITED_FOR_ANSWER,
      LEFT_THE_ASKING_TO_THE_CARD,
      SAID_NOTHING_AFTER_ASKING,
      REPLIED,
    ],
    kind: "chat",
    name: "questions-skipped",
    prompt: PROMPT,
  }),
  defineEval({
    answers: [{ declined: true, note: "You pick. We're in Portland." }],
    assertions: [
      ASKED_ONCE,
      NO_ESCAPE_CHOICES,
      WAITED_FOR_ANSWER,
      LEFT_THE_ASKING_TO_THE_CARD,
      SAID_NOTHING_AFTER_ASKING,
      REPLIED,
      mentions("Portland"),
    ],
    kind: "chat",
    name: "questions-skipped-with-note",
    prompt: PROMPT,
  }),
];
