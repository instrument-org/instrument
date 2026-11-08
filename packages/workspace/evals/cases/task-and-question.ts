/**
 * Does a task started in the same breath as a question do only its own part?
 *
 * One message asks the chat to start a background task and to ask a
 * multiple-choice question while it runs. The chat's first step usually
 * makes both calls, `instrument task new` and `choose`, and the task carries
 * the conversation on from that step. A task that read the user's message
 * as still unanswered redid the chat's turn: it ran `task new` and `choose`
 * again, was refused both, and reported to the chat that the task never
 * started and the card never showed, which the chat believed and asked
 * again. The card is left unanswered, as it was when that happened.
 *
 * - **The task does only its assignment.** It writes the haiku, and never
 *   runs `instrument task new` or calls `choose`.
 * - **The chat asks once.** One `choose` card in the chat, whatever the
 *   task reports.
 */
import fs from "node:fs";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";
import { deliveredFile } from "../lib/delivered-file";

const PLANETS = [
  "Mercury",
  "Venus",
  "Earth",
  "Mars",
  "Jupiter",
  "Saturn",
  "Uranus",
  "Neptune",
];

/** How many times a set of sessions ran `instrument task new`, and called `choose`. */
function chatOnlyCalls(sessions: Session.WithMessagesAndParts[]) {
  let taskNew = 0;
  let choose = 0;
  for (const part of sessions.flatMap((session) =>
    session.messages.flatMap((message) => message.parts),
  )) {
    if (part.type === "tool-choose") {
      choose += 1;
    } else if (part.type === "tool-bash") {
      const command: string = part.input?.command ?? "";
      taskNew += [...command.matchAll(/(?:^|[\n;&|])\s*instrument task new\b/g)]
        .length;
    }
  }
  return { choose, taskNew };
}

const startedOneTask: Assertion = {
  check: async (ctx) => {
    const text = "started one task";
    const children = await ctx.childSessions();
    return {
      evidence: `${String(children.length)} tasks: ${children.map((child) => child.title).join(", ")}`,
      passed: children.length === 1,
      text,
    };
  },
  text: "started one task",
};

const taskDidOnlyItsPart: Assertion = {
  check: async (ctx) => {
    const text = "the task ran no `task new` and called no `choose`";
    const children = await ctx.childSessions();
    const calls = chatOnlyCalls(children.flatMap((child) => child.sessions));
    return {
      evidence: `task new ${String(calls.taskNew)}, choose ${String(calls.choose)}`,
      passed: children.length > 0 && calls.taskNew === 0 && calls.choose === 0,
      text,
    };
  },
  text: "the task ran no `task new` and called no `choose`",
};

/**
 * The task's last words name nothing it needs from the user: the haiku need
 * nothing, and the question is the chat's, already on its card.
 */
const taskAskedNothing: Assertion = {
  check: async (ctx) => {
    const text = "the task's report has no needs fence";
    const children = await ctx.childSessions();
    const last = children
      .flatMap((child) => child.sessions)
      .flatMap((session) => session.messages)
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" ? [part.text] : [],
        ),
      )
      .at(-1);
    const needs = /```needs\b[\s\S]*?```/.exec(last ?? "")?.[0];
    return {
      evidence: needs ?? (last ?? "(no report)").slice(-200),
      passed: last !== undefined && needs === undefined,
      text,
    };
  },
  text: "the task's report has no needs fence",
};

const askedOnce: Assertion = {
  check: (ctx) => {
    const text = "the chat asked on one card";
    const calls = chatOnlyCalls(ctx.sessions);
    return {
      evidence: `${String(calls.choose)} choose calls in the chat`,
      passed: calls.choose === 1,
      text,
    };
  },
  text: "the chat asked on one card",
};

const wroteTheHaiku: Assertion = {
  check: ({ chatId }) => {
    const text = "haikus.md names every planet";
    const file = deliveredFile(chatId, "haikus.md");
    if (!file) {
      return { evidence: "no haikus.md", passed: false, text };
    }
    const body = fs.readFileSync(file, "utf8");
    const missing = PLANETS.filter((planet) => !body.includes(planet));
    return {
      evidence:
        missing.length === 0
          ? body.slice(0, 200)
          : `missing ${missing.join(", ")}`,
      passed: missing.length === 0,
      text,
    };
  },
  text: "haikus.md names every planet",
};

export const TASK_AND_QUESTION_EVALS = [
  defineEval({
    assertions: [
      startedOneTask,
      taskDidOnlyItsPart,
      taskAskedNothing,
      askedOnce,
      wroteTheHaiku,
    ],
    kind: "chat",
    name: "task-and-question",
    prompt:
      "Start a background task that writes a short haiku about each planet into haikus.md. While that runs, ask me which planet is my favorite as a multiple-choice question.",
  }),
];
