import { describe, expect, it } from "vitest";

import { SessionMessageDataPart } from "../schemas/session/message-data-part";
import { StoreId } from "../schemas/store-id";
import {
  answerModelLines,
  askLine,
  chooseAnswer,
  chooseQuestions,
} from "./choose-call";

const card = {
  questions: [
    {
      choices: [
        { description: "Where most customers are", label: "10 agents" },
        { label: "25 agents" },
      ],
      header: "Team size",
      question: "Which team size should I compare at?",
    },
    {
      choices: [{ label: "Zendesk" }, { label: "Intercom" }],
      header: "Competitors",
      multiSelect: true,
      question: "Which competitors go in the table?",
    },
  ],
};

describe("chooseQuestions", () => {
  it("reads a card's questions, and an earlier build's one question with bare labels", () => {
    expect(chooseQuestions(card)).toEqual(card.questions);
    expect(
      chooseQuestions({ choices: ["Tea", "Coffee"], question: "Which one?" }),
    ).toEqual([
      {
        choices: [{ label: "Tea" }, { label: "Coffee" }],
        header: "",
        question: "Which one?",
      },
    ]);
  });

  it("reads nothing from an input still arriving", () => {
    expect(chooseQuestions({ questions: [{ header: "Te" }] })).toEqual([]);
    expect(chooseQuestions(undefined)).toEqual([]);
  });
});

describe("chooseAnswer", () => {
  it.each([
    { output: { asked: true }, read: undefined },
    {
      output: { answer: { replies: [{ picked: ["Tea"] }] }, asked: true },
      read: { replies: [{ picked: ["Tea"] }] },
    },
    // An earlier build's answer written onto the call, and a waiting turn's
    // answer returned as the call's output.
    {
      output: { answer: { note: "Hot.", selectedChoice: "Tea" }, asked: true },
      read: { note: "Hot.", replies: [{ picked: ["Tea"] }] },
    },
    { output: { declined: true }, read: { replies: [{ skipped: true }] } },
  ])("reads $output", ({ output, read }) => {
    expect(chooseAnswer(output)).toEqual(read);
  });
});

it("names a card of several questions by its first and how many more", () => {
  expect(askLine(card.questions)).toBe(
    "Which team size should I compare at? (and 1 more)",
  );
});

it("tells the agent each question's answer, a skip, own words and the note", () => {
  expect(
    answerModelLines(card.questions, {
      note: "List prices only.",
      replies: [{ skipped: true }, { picked: ["Zendesk", "Help Scout"] }],
    }).join("\n"),
  ).toMatchInlineSnapshot(`
    "The user answered the questions on your card:
    - "Which team size should I compare at?": skipped
    - "Which competitors go in the table?": Zendesk, Help Scout (in their own words)
    For each one they skipped, decide without its answer: take the likelier reading and say which, or say what you cannot do without it.
    Their note: List prices only."
  `);
});

it("reads an earlier build's answer part as a card of one question", () => {
  const partId = StoreId.newPartId();
  expect(
    SessionMessageDataPart.QuestionAnswerDataPartSchema.parse({
      answer: { declined: true },
      partId,
      question: "Which one?",
    }),
  ).toEqual({
    answer: { replies: [{ skipped: true }] },
    partId,
    questions: ["Which one?"],
  });
});
