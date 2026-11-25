/**
 * What the app list every chat starts with leads the agent to do.
 *
 * `app-lines-unrelated`: several apps stand half connected and the user asks
 * for something none of them touches. Scored: no sign-in card, no `instrument
 * app` command, and no word about an app or signing in.
 *
 * `app-lines-link`: Beacon is connected by a sign-in made in the user's own
 * browser, and they ask for a link into it. Scored: the link is given and no
 * sign-in card is. Whether the reply says the page may ask for a sign-in is
 * read in the transcript, not scored: nothing tells the agent to.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

function partsOf(sessions: Session.WithMessagesAndParts[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.map((part) => ({ part, role: message.role })),
    ),
  );
}

/** Everything the agent said, in order. */
function said(sessions: Session.WithMessagesAndParts[]): string {
  return partsOf(sessions)
    .flatMap(({ part, role }) =>
      role === "assistant" && part.type === "text" ? [part.text] : [],
    )
    .join("\n");
}

function assertion(
  text: string,
  check: (sessions: Session.WithMessagesAndParts[]) => {
    evidence: string;
    passed: boolean;
  },
): Assertion {
  return { check: ({ sessions }) => ({ ...check(sessions), text }), text };
}

const noCard = assertion("asked for no sign-in", (sessions) => {
  const cards = partsOf(sessions).filter(
    ({ part }) => part.type === "tool-connect_app",
  );
  return { evidence: `${cards.length} cards`, passed: cards.length === 0 };
});

const noAppCommand = assertion("ran no app command", (sessions) => {
  const commands = partsOf(sessions).flatMap(({ part }) =>
    part.type === "tool-bash" &&
    /\binstrument app\b/.test(String(part.input?.command ?? ""))
      ? [String(part.input?.command)]
      : [],
  );
  return {
    evidence: commands.join(" | ") || "none",
    passed: commands.length === 0,
  };
});

const noMention = assertion(
  "said nothing of an app or signing in",
  (sessions) => {
    const reply = said(sessions);
    return {
      evidence: reply.slice(0, 400),
      passed:
        reply !== "" &&
        !/\b(?:beacon|notion|shopify|sign(?:ed|ing)?[ -]in|connect(?:ed|ing)?)\b/i.test(
          reply,
        ),
    };
  },
);

const givesLink = assertion("gave the issue's link", (sessions) => {
  const reply = said(sessions);
  return {
    evidence: reply.slice(-400),
    passed: /app\.beacon\.example\/issues\/BCN-118\b/.test(reply),
  };
});

const BEACON = {
  account: "Northwind",
  guide:
    "Beacon tracks the team's issues. An issue's page is https://app.beacon.example/issues/<id>.\n",
  kind: "signed-in" as const,
  name: "Beacon",
  slug: "beacon",
};

export const APP_LINES_EVALS = [
  defineEval({
    apps: [
      BEACON,
      { kind: "sign-in", name: "Notion", slug: "notion" },
      {
        kind: "web-sign-in",
        name: "Shopify",
        slug: "shopify",
        url: "https://admin.shopify.com",
      },
    ],
    assertions: [noCard, noAppCommand, noMention],
    kind: "chat",
    name: "app-lines-unrelated",
    prompt:
      "Write me a short thank-you note to Priya for covering my shift on Friday. Just give it to me here.",
    signInsAnswerAs: {},
  }),
  defineEval({
    apps: [BEACON],
    assertions: [givesLink, noCard],
    kind: "chat",
    name: "app-lines-link",
    prompt:
      "Who is BCN-118 in Beacon assigned to? Give me the link too so I can read it here.",
    signInsAnswerAs: {},
  }),
];
