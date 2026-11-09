/**
 * When a connected app's sign-in has lapsed, does the agent ask for it again
 * on a card, without being told to and without a detour first?
 *
 * Beacon, an issue tracker over MCP, is connected by a sign-in its server
 * has stopped taking (`signed-out`), so the first thing the agent runs
 * against it is refused. The user only asks a question Beacon answers. The
 * run then signs in on whatever card comes up (`signInsAnswerAs`), after
 * which the server takes the app's calls. Scored: a call met the refusal;
 * a sign-in card for Beacon followed; nothing ran between the two that the
 * refusal did not ask for (`app test`, a move to the web, a second try); and
 * once the card was answered, the agent went back to Beacon and answered.
 */
import { type Session } from "../../src/schemas/session";
import { connectAppResults } from "../../src/tools/connect-app-output";
import { type Assertion, defineEval } from "../harness";

const SLUG = "beacon";
const APP_COMMAND = new RegExp(
  String.raw`\bapp\s+(call|guide|new|request|test|tools)\s+${SLUG}\b`,
);

type Step =
  | { card: string | undefined; kind: "card" }
  | { command: string; kind: "app"; verb: string }
  | { kind: "note" }
  | { kind: "text"; text: string };

/** What a session did with Beacon, in order, as far as this case reads it. */
function steps(sessions: Session.WithMessagesAndParts[]): Step[] {
  const found: Step[] = [];
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "data-appEvent") {
          if (part.data.events.some((each) => each.slug === SLUG)) {
            found.push({ kind: "note" });
          }
        } else if (
          part.type === "tool-connect_app" &&
          part.state === "output-available"
        ) {
          const result = connectAppResults(part.output).find(
            (each) => each.slug === SLUG,
          );
          if (result) {
            found.push({
              card: result.state === "asked" ? result.kind : result.state,
              kind: "card",
            });
          }
        } else if (part.type === "tool-bash") {
          const command = String(part.input?.command ?? "");
          const verb = APP_COMMAND.exec(command)?.[1];
          if (verb !== undefined) {
            found.push({ command, kind: "app", verb });
          }
        } else if (
          message.role === "assistant" &&
          part.type === "text" &&
          part.text.trim() !== ""
        ) {
          found.push({ kind: "text", text: part.text });
        }
      }
    }
  }
  return found;
}

function describe(found: Step[]): string {
  return (
    found
      .map((step) => {
        switch (step.kind) {
          case "app":
            return `app ${step.verb}: ${step.command.slice(0, 120)}`;
          case "card":
            return `connect_app (${step.card ?? "?"})`;
          case "note":
            return "note";
          case "text":
            return `text: ${step.text.slice(0, 160)}`;
        }
      })
      .join(" | ") || "nothing"
  );
}

const chatOnly = (sessions: Session.WithMessagesAndParts[]) =>
  sessions.filter((session) => !session.parentId);

const isCard = (step: Step) => step.kind === "card" && step.card === "sign-in";

/** The scenario was reached: something ran against Beacon before any card. */
const metTheRefusal: Assertion = {
  check: async ({ childSessions, sessions }) => {
    const text = "ran against Beacon and met the refusal";
    const everywhere = steps([
      ...sessions,
      ...(await childSessions()).flatMap((child) => child.sessions),
    ]);
    const chat = steps(chatOnly(sessions));
    const card = chat.findIndex(isCard);
    return {
      evidence: describe(everywhere),
      passed:
        everywhere.some((step) => step.kind === "app") &&
        // In the chat itself, the card never comes before a first try: a
        // try in a task is the only one the chat's own steps leave out.
        (card === -1 ||
          chat.slice(0, card).some((step) => step.kind === "app") ||
          everywhere.length > chat.length),
      text,
    };
  },
  text: "ran against Beacon and met the refusal",
};

/** Asked for the sign-in on a card, before the user said anything more. */
const asksOnACard: Assertion = {
  check: ({ sessions }) => {
    const text = "put a sign-in card up for Beacon";
    const found = steps(chatOnly(sessions));
    return {
      evidence: describe(found),
      passed: found.some(isCard),
      text,
    };
  },
  text: "put a sign-in card up for Beacon",
};

/** Went from the refusal to the card: no test, no move to the web, no second try. */
const goesStraightToTheCard: Assertion = {
  check: ({ sessions }) => {
    const text = "went from the refusal to the card with nothing between";
    const found = steps(chatOnly(sessions));
    const refused = found.findIndex((step) => step.kind === "app");
    const card = found.findIndex(isCard);
    const between =
      refused === -1 || card === -1 ? [] : found.slice(refused + 1, card);
    const detours = between.filter((step) => step.kind === "app");
    return {
      evidence:
        card === -1 ? "no card" : describe(detours).replace("nothing", "none"),
      passed: card !== -1 && detours.length === 0,
      text,
    };
  },
  text: "went from the refusal to the card with nothing between",
};

/** Once signed in, went back to Beacon and said what it found. */
const finishesTheWork: Assertion = {
  check: async ({ childSessions, sessions }) => {
    const text = "went back to Beacon after the sign-in and answered";
    const chat = steps(chatOnly(sessions));
    const note = chat.findIndex((step) => step.kind === "note");
    const after = note === -1 ? [] : chat.slice(note + 1);
    const inTasks = steps(
      (await childSessions()).flatMap((child) => child.sessions),
    );
    return {
      evidence: note === -1 ? "no note" : describe(after),
      passed:
        after.some((step) => step.kind === "text") &&
        [...after, ...inTasks].some(
          (step) => step.kind === "app" && step.verb === "call",
        ),
      text,
    };
  },
  text: "went back to Beacon after the sign-in and answered",
};

export const APP_SIGN_IN_LOST_EVALS = [
  defineEval({
    apps: [{ kind: "signed-out", name: "Beacon", slug: SLUG }],
    assertions: [
      metTheRefusal,
      asksOnACard,
      goesStraightToTheCard,
      finishesTheWork,
    ],
    kind: "chat",
    name: "app-sign-in-lost",
    prompt: "Which open issues in Beacon are urgent right now?",
    signInsAnswerAs: {},
  }),
];
