/**
 * When a web app has no sign-in recorded on this computer, does the agent
 * look at the site before asking for one, and ask only when it loads signed
 * out?
 *
 * Nothing sees a session in the browser, so the user may well be signed in
 * already: from a tab the agent opened, an earlier visit, or the same app
 * set up and signed in on another of their computers.
 *
 * `app-web-signed-in`: Shopify, set up and not marked signed in; its real
 * site loads signed out in the run. Scored: the agent opened the store's
 * site in a tab before any `connect_app` card, and did not set Shopify up
 * again.
 *
 * `app-web-already-signed-in`: a shop whose site, served on loopback, loads
 * signed in. Scored: no card, the sign-in it saw recorded with
 * `connect_app`'s `signedIn`, and the answer the page shows.
 */
import { connectAppResults } from "../../src/tools/connect-app-output";
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

const SHOP = "acme-shop";

/** A shop's admin page, signed in, with the answer on it. */
const SIGNED_IN_PAGE = `<!doctype html>
<html><head><title>Acme Shop admin</title></head>
<body>
  <header>Acme Shop admin · Signed in as Sam Rivera · <a href="/logout">Sign out</a></header>
  <main>
    <h1>Today</h1>
    <p>Orders today: <strong>14</strong></p>
    <p>Revenue today: $1,212.40</p>
  </main>
</body></html>`;

/** Every `connect_app` call the chat made, with what it named and what came of each app. */
function connectCalls(sessions: Session.WithMessagesAndParts[]) {
  return sessions
    .filter((session) => !session.parentId)
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type === "tool-connect_app" && part.state === "output-available"
        ? [
            {
              results: connectAppResults(part.output),
              signedIn: part.input.signedIn ?? [],
            },
          ]
        : [],
    );
}

const noCard: Assertion = {
  check: ({ sessions }) => {
    const text = "asked for no sign-in on a site that loaded signed in";
    const asked = connectCalls(sessions).flatMap(({ results }) =>
      results.filter((result) => result.state === "asked"),
    );
    return {
      evidence:
        asked.map((result) => `card row: ${result.slug}`).join(" | ") ||
        "no card",
      passed: asked.length === 0,
      text,
    };
  },
  text: "asked for no sign-in on a site that loaded signed in",
};

const recordsTheSignIn: Assertion = {
  check: ({ sessions }) => {
    const text = "recorded the sign-in it saw with connect_app's signedIn";
    const calls = connectCalls(sessions);
    return {
      evidence:
        calls
          .map(
            ({ results, signedIn }) =>
              `signedIn [${signedIn.join(", ")}]: ${results.map((result) => `${result.slug} ${result.state}`).join(", ")}`,
          )
          .join(" | ") || "no connect_app call",
      passed: calls.some(({ results }) =>
        results.some(
          (result) =>
            result.slug === SHOP &&
            result.state === "connected" &&
            result.seen === true,
        ),
      ),
      text,
    };
  },
  text: "recorded the sign-in it saw with connect_app's signedIn",
};

const answers: Assertion = {
  check: ({ sessions }) => {
    const text = "answered with the 14 orders the page shows";
    const said = sessions
      .filter((session) => !session.parentId)
      .flatMap((session) => session.messages)
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.parts)
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    return {
      evidence: said.slice(-300) || "no reply",
      passed: /\b14\b/.test(said),
      text,
    };
  },
  text: "answered with the 14 orders the page shows",
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
    sharedBrowser: true,
    prompt: "How many orders came in on my Shopify store today?",
  }),
  defineEval({
    apps: [
      {
        kind: "web-sign-in",
        name: "Acme Shop",
        page: SIGNED_IN_PAGE,
        slug: SHOP,
      },
    ],
    assertions: [noCard, recordsTheSignIn, answers],
    kind: "chat",
    name: "app-web-already-signed-in",
    sharedBrowser: true,
    prompt: "How many orders came in on my Acme Shop store today?",
  }),
];
