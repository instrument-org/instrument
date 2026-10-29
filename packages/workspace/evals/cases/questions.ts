/**
 * Does the conversation go on sensibly after a card is answered, and does
 * it put what it needs to ask on one card?
 *
 * A `choose` card's question can come back four ways: one of the choices,
 * the user's own words, a skip, and any of those with a note. The last three
 * are easy for a model to mishandle in ways no unit test sees: asking the
 * same question again after a skip, ignoring a note, or treating an answer it
 * did not offer as a mistake. Each case asks for something small enough that
 * the conversation does it itself, tells it to ask first, and answers one way.
 *
 * A card holds up to four questions, answered together. The cases that need
 * several answers check they arrive on one card rather than a card each,
 * which would wake the chat on the first answer with the rest still open.
 *
 * The call returns at once and the answer arrives later as a message of its
 * own, so each case also scores what the agent did in between: a tagline
 * written before the tone was picked is the work done without the answer.
 */
import {
  type ChooseQuestion,
  chooseQuestions,
} from "../../src/lib/choose-call";
import { type Session } from "../../src/schemas/session";
import { type Assertion, answerEach, defineEval, pickChoice } from "../harness";

const PROMPT =
  "Write me a one-line tagline for my bakery. Ask me which tone I want first, as a choice.";

/** Each `choose` card the conversation put up, as its questions. */
function cards(sessions: Session.WithMessagesAndParts[]): ChooseQuestion[][] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-choose" ? [chooseQuestions(part.input)] : [],
      ),
    ),
  );
}

function describeCards(all: ChooseQuestion[][]): string {
  return all
    .map((questions, index) =>
      [
        `card ${index + 1}:`,
        ...questions.map(
          ({ choices, header, multiSelect, question }) =>
            `  ${header ? `[${header}] ` : ""}${question}${multiSelect ? " (several)" : ""} [${choices.map((choice) => choice.label).join(" | ")}]`,
        ),
      ].join("\n"),
    )
    .join("\n");
}

/**
 * What the conversation said after the last card, split at its answer:
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
    const all = cards(sessions);
    return {
      evidence: describeCards(all),
      passed: all.length === 1 && all[0]?.length === 1,
      text: "asked exactly one question",
    };
  },
  text: "asked exactly one question",
};

/** Everything it needed went on one card, with a header on each question. */
function askedOnOneCard(atLeast: number): Assertion {
  const text = `asked ${atLeast} or more questions on one card, each with a header`;
  return {
    check: ({ sessions }) => {
      const all = cards(sessions);
      const [card] = all;
      return {
        evidence: describeCards(all),
        passed:
          all.length === 1 &&
          card !== undefined &&
          card.length >= atLeast &&
          card.every(({ header }) => header.trim() !== ""),
        text,
      };
    },
    text,
  };
}

const LET_THEM_PICK_SEVERAL: Assertion = {
  check: ({ sessions }) => {
    const all = cards(sessions);
    return {
      evidence: describeCards(all),
      passed: all.flat().some((question) => question.multiSelect === true),
      text: "let them pick more than one",
    };
  },
  text: "let them pick more than one",
};

/** One card was enough: a skip is an answer, not a reason to ask again. */
const ASKED_NO_SECOND_CARD: Assertion = {
  check: ({ sessions }) => {
    const all = cards(sessions);
    return {
      evidence: describeCards(all),
      passed: all.length === 1,
      text: "put up no second card after the answer",
    };
  },
  text: "put up no second card after the answer",
};

const NO_ESCAPE_CHOICES: Assertion = {
  check: ({ sessions }) => {
    const labels = cards(sessions)
      .flat()
      .flatMap(({ choices }) => choices.map((choice) => choice.label));
    const escapes = labels.filter((label) =>
      /\b(?:other|skip|something else|none of|surprise me|your call)\b/i.test(
        label,
      ),
    );
    return {
      evidence: escapes.join(", ") || labels.join(", "),
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

const ONE_QUESTION_ASSERTIONS = [
  ASKED_ONCE,
  NO_ESCAPE_CHOICES,
  WAITED_FOR_ANSWER,
  LEFT_THE_ASKING_TO_THE_CARD,
  SAID_NOTHING_AFTER_ASKING,
  REPLIED,
];

// Three picks the email needs, each with a few obvious choices, and nothing
// open-ended for prose to ask: what is scored is whether they share a card.
const WELCOME_EMAIL_PROMPT =
  "Write a short welcome email for new customers of Rise Bakery in Portland, signed by me, Dana. Before you write it, let me choose its tone, its length, and whether it offers a first-order discount.";

export const QUESTIONS_EVALS = [
  defineEval({
    answers: [
      answerEach((question) => pickChoice(question), "Mention our sourdough."),
    ],
    assertions: [...ONE_QUESTION_ASSERTIONS, mentions("sourdough")],
    kind: "chat",
    name: "questions-choice-with-note",
    prompt: PROMPT,
  }),
  defineEval({
    answers: [
      { replies: [{ picked: ["Deadpan, like a bored museum guard"] }] },
    ],
    assertions: ONE_QUESTION_ASSERTIONS,
    kind: "chat",
    name: "questions-own-answer",
    prompt: PROMPT,
  }),
  defineEval({
    answers: [{ replies: [{ skipped: true }] }],
    assertions: ONE_QUESTION_ASSERTIONS,
    kind: "chat",
    name: "questions-skipped",
    prompt: PROMPT,
  }),
  defineEval({
    answers: [
      {
        note: "You pick. We're in Portland.",
        replies: [{ skipped: true }],
      },
    ],
    assertions: [...ONE_QUESTION_ASSERTIONS, mentions("Portland")],
    kind: "chat",
    name: "questions-skipped-with-note",
    prompt: PROMPT,
  }),
  defineEval({
    // Nothing says to ask them together: three picks go on one card rather
    // than a card each, or a card and then another after its answer.
    answers: [answerEach((question) => pickChoice(question))],
    assertions: [
      askedOnOneCard(3),
      NO_ESCAPE_CHOICES,
      SAID_NOTHING_AFTER_ASKING,
      REPLIED,
    ],
    kind: "chat",
    name: "questions-several-on-one-card",
    prompt: WELCOME_EMAIL_PROMPT,
  }),
  defineEval({
    // The first question is skipped and the rest answered: it carries on
    // with what it has rather than asking the skipped one again.
    answers: [
      (questions) => ({
        replies: questions.map((question, index) =>
          index === 0 ? { skipped: true } : pickChoice(question),
        ),
      }),
    ],
    assertions: [askedOnOneCard(2), REPLIED, ASKED_NO_SECOND_CARD],
    kind: "chat",
    name: "questions-several-one-skipped",
    prompt: WELCOME_EMAIL_PROMPT,
  }),
  defineEval({
    answers: [
      answerEach((question) =>
        question.multiSelect === true
          ? {
              picked: question.choices
                .map((choice) => choice.label)
                .filter((label) => /babka|croissant/i.test(label)),
            }
          : pickChoice(question),
      ),
    ],
    assertions: [
      LET_THEM_PICK_SEVERAL,
      SAID_NOTHING_AFTER_ASKING,
      REPLIED,
      mentions("babka"),
      mentions("croissant"),
    ],
    kind: "chat",
    name: "questions-pick-several",
    prompt:
      "Draft this week's newsletter blurb for my bakery featuring some of our products: sourdough, croissants, babka, and cookies. Ask me which ones to feature first; I may want more than one.",
  }),
];
