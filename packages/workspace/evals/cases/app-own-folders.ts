import { DRAFTS_FOLDER_NAME } from "../../src/constants";
import { chooseQuestions } from "../../src/lib/choose-call";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * A person asking for "a draft" means a draft of their own work, and the
 * app's `Drafts/` (their unsent replies) is never where it goes or a place
 * to offer it. A person who knows the app well enough to mean that folder
 * says so, so the cases never name it.
 */

/** Everything the run's tool calls said, and every choice its cards offered. */
function whatItReachedFor(sessions: Session.WithMessagesAndParts[]) {
  const parts = sessions
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts);
  const calls = parts
    .filter(
      (part) => part.type.startsWith("tool-") && part.type !== "tool-choose",
    )
    .map((part) => JSON.stringify("input" in part ? part.input : part));
  const choices = parts.flatMap((part) =>
    part.type === "tool-choose"
      ? chooseQuestions(part.input).flatMap((question) =>
          question.choices.map(
            (choice) => `${choice.label} ${choice.description ?? ""}`,
          ),
        )
      : [],
  );
  return { calls, choices };
}

const leavesTheAppsDraftsAlone: Assertion = {
  check: ({ sessions }) => {
    const { calls, choices } = whatItReachedFor(sessions);
    const segment = new RegExp(`[/"']${DRAFTS_FOLDER_NAME}(/|["'\\s]|$)`);
    const touched = calls.filter((call) => segment.test(call));
    const offered = choices.filter((choice) =>
      new RegExp(`\\b${DRAFTS_FOLDER_NAME}\\b`).test(choice),
    );
    return {
      evidence:
        touched.length > 0 || offered.length > 0
          ? [
              ...touched.map(
                (call) => `Reached into it: ${call.slice(0, 200)}`,
              ),
              ...offered.map((choice) => `Offered: ${choice}`),
            ].join("\n")
          : "Never named the app's Drafts folder",
      passed: touched.length === 0 && offered.length === 0,
      text: "Never reaches into or offers the app's Drafts folder for a draft of the person's work",
    };
  },
  text: "Never reaches into or offers the app's Drafts folder for a draft of the person's work",
};

export const APP_OWN_FOLDERS_EVALS = [
  // The words from a first-run session that offered "Instrument Drafts".
  defineEval({
    assertions: [leavesTheAppsDraftsAlone],
    name: "app-own-folders-draft-in-my-library",
    prompt:
      "Can you start a new draft in my library for a Patreon post announcing my new knitting pattern collection?",
  }),
  defineEval({
    assertions: [leavesTheAppsDraftsAlone],
    name: "app-own-folders-blog-draft",
    prompt: "Start a draft of a short blog post about my autumn quilt pattern.",
  }),
];
