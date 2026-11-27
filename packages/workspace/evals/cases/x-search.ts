/**
 * With a Grok plan signed in, does the agent answer a question about what
 * people are saying on X with X's own search, rather than a tab on x.com,
 * which is not signed in, or a sign-in card?
 *
 * `x-search`: the X app as a Grok sign-in sets it up, its search answered on
 * loopback (`grokPlan`) with three posts about a library's late hours that
 * no model knows. Scored: a search with `instrument app call x search` (or
 * the app's search in a script), no sign-in card, and an answer from the
 * posts.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";
import { type StandInPost } from "../lib/grok-stand-in";

const POSTS: StandInPost[] = [
  {
    date: "2026-11-23",
    handle: "mosswoodlibrary",
    id: "1992870000000000001",
    text: "Starting Monday, Mosswood Library stays open until 11pm on weeknights. Study rooms can be booked online.",
  },
  {
    date: "2026-11-25",
    handle: "dana_reads",
    id: "1992870000000000002",
    text: "Mosswood's late hours are a lifesaver for night-shift people. Went at 10pm and it was packed.",
  },
  {
    date: "2026-11-26",
    handle: "cityhallwatch",
    id: "1992870000000000003",
    text: "The Mosswood late hours are a six-month pilot paid for out of the parks budget. Council reviews it in May.",
  },
];

const X_SEARCH =
  /\bapp\s+call\s+x\s+search\b|\bapps(?:\.x|\[\s*["']x["']\s*\])\.search\b/;

/** The chat's own session's parts, in order. */
function parts(sessions: Session.WithMessagesAndParts[]) {
  return sessions
    .filter((session) => !session.parentId)
    .flatMap((session) => session.messages)
    .flatMap((message) =>
      message.parts.map((part) => ({ part, role: message.role })),
    );
}

const searchesX: Assertion = {
  check: ({ sessions }) => {
    const text = "searched with X's own search";
    const inputs = parts(sessions).flatMap(({ part }) =>
      part.type.startsWith("tool-") && "input" in part
        ? [`${part.type.slice(5)} ${JSON.stringify(part.input)}`]
        : [],
    );
    return {
      evidence:
        inputs.map((input) => input.slice(0, 140)).join(" | ") ||
        "no tool call",
      passed: inputs.some((input) => X_SEARCH.test(input)),
      text,
    };
  },
  text: "searched with X's own search",
};

const noCard: Assertion = {
  check: ({ sessions }) => {
    const text = "asked for no sign-in";
    const cards = parts(sessions).filter(
      ({ part }) => part.type === "tool-connect_app",
    );
    return {
      evidence:
        cards
          .map(({ part }) => JSON.stringify(part).slice(0, 200))
          .join(" | ") || "no card",
      passed: cards.length === 0,
      text,
    };
  },
  text: "asked for no sign-in",
};

const answers: Assertion = {
  check: ({ sessions }) => {
    const text = "answered from the posts: open until 11pm, a six-month pilot";
    const said = parts(sessions)
      .flatMap(({ part, role }) =>
        role === "assistant" && part.type === "text" ? [part.text] : [],
      )
      .join("\n");
    return {
      evidence: said.slice(-400) || "no reply",
      passed: /\b11\b/.test(said) && /pilot|six.month|6.month/i.test(said),
      text,
    };
  },
  text: "answered from the posts: open until 11pm, a six-month pilot",
};

export const X_SEARCH_EVALS = [
  defineEval({
    assertions: [searchesX, noCard, answers],
    grokPlan: { posts: POSTS },
    kind: "chat",
    name: "x-search",
    prompt:
      "What are people on X saying about the Mosswood Library's new late hours?",
  }),
];
