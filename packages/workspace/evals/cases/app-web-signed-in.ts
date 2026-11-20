/**
 * When a web app waits on the user's word that they signed in, does the
 * agent look at the site before asking for another sign-in?
 *
 * Shopify is set up as a web app and not marked signed in (`web-sign-in`):
 * nothing sees a session in the browser, so the user may well be signed in
 * already, from a tab the agent opened or an earlier visit, and only never
 * pressed Done on a card. The user asks a question the store answers.
 * Scored: the agent opened the store's site in a tab before any
 * `connect_app` card, and did not set Shopify up again.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

const SLUG = "shopify";
const HOST = "admin.shopify.com";
const SET_UP_AGAIN = new RegExp(String.raw`\bapp\s+new\s+${SLUG}\b`);

type Step =
  | { command: string; kind: "set-up" }
  | { input: string; kind: "site" }
  | { kind: "card" };

/** What the chat did with Shopify, in order, as far as this case reads it. */
function steps(sessions: Session.WithMessagesAndParts[]): Step[] {
  const found: Step[] = [];
  for (const session of sessions) {
    if (session.parentId) {
      continue;
    }
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "tool-connect_app") {
          found.push({ kind: "card" });
        } else if (part.type.startsWith("tool-") && "input" in part) {
          const input = JSON.stringify(part.input);
          if (SET_UP_AGAIN.test(input)) {
            found.push({ command: input, kind: "set-up" });
          } else if (input.includes(HOST)) {
            found.push({ input, kind: "site" });
          }
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
          case "card":
            return "connect_app";
          case "set-up":
            return `set up again: ${step.command.slice(0, 120)}`;
          case "site":
            return `site: ${step.input.slice(0, 120)}`;
        }
      })
      .join(" | ") || "nothing"
  );
}

const looksFirst: Assertion = {
  check: ({ sessions }) => {
    const text = "opened the store's site in a tab before any sign-in card";
    const found = steps(sessions);
    const site = found.findIndex((step) => step.kind === "site");
    const card = found.findIndex((step) => step.kind === "card");
    return {
      evidence: describe(found),
      passed: site !== -1 && (card === -1 || site < card),
      text,
    };
  },
  text: "opened the store's site in a tab before any sign-in card",
};

const keepsTheSetup: Assertion = {
  check: ({ sessions }) => {
    const text = "did not set Shopify up again";
    const found = steps(sessions);
    return {
      evidence: describe(found),
      passed: !found.some((step) => step.kind === "set-up"),
      text,
    };
  },
  text: "did not set Shopify up again",
};

export const APP_WEB_SIGNED_IN_EVALS = [
  defineEval({
    apps: [
      {
        kind: "web-sign-in",
        name: "Shopify",
        slug: SLUG,
        url: `https://${HOST}`,
      },
    ],
    assertions: [looksFirst, keepsTheSetup],
    kind: "chat",
    name: "app-web-signed-in",
    prompt: "How many orders came in on my Shopify store today?",
  }),
];
