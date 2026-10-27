/**
 * When one errand needs several apps, does the agent ask for all of them on
 * one card, and answer once when the card settles?
 *
 * Four Google stand-ins are set up and waiting for a sign-in. The user asks
 * to connect them for one errand; the run then answers the card's rows one
 * at a time, a couple of seconds apart, as a person working down the card
 * does: three connect and Calendar is skipped (`signInsAnswerAs`). Scored:
 * one `connect_app` call named all four; the chat was woken once, by a note
 * carrying the whole card, so it had no turn to post a line per connection;
 * and the reply to that note names what connected and what was skipped
 * without restating the count the card already shows.
 */
import { type Session } from "../../src/schemas/session";
import { askedOnCard } from "../../src/tools/connect-app-output";
import { type Assertion, defineEval } from "../harness";

const APPS = [
  { name: "Google Drive", slug: "gdrive", word: /\bdrive\b/i },
  { name: "Google Docs", slug: "gdocs", word: /\bdocs\b/i },
  { name: "Google Calendar", slug: "gcal", word: /\bcalendar\b/i },
  { name: "Gmail", slug: "gmail", word: /\bgmail\b/i },
] as const;
const SKIPPED = "gcal";
const COUNT = /\b(?:\d|one|two|three|four)\s+(?:of|out of)\s+(?:\d|four)\b/i;

type Step =
  | { kind: "card"; slugs: string[] }
  | { apps: string[]; kind: "note" }
  | { kind: "text"; text: string };

/** What the chat's own session did, in order, as far as this case reads it. */
function steps(sessions: Session.WithMessagesAndParts[]): Step[] {
  const found: Step[] = [];
  for (const session of sessions) {
    if (session.parentId) {
      continue;
    }
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "data-appEvent" && part.data.carried !== true) {
          found.push({
            apps: part.data.events.map((event) => event.slug),
            kind: "note",
          });
        } else if (
          part.type === "tool-connect_app" &&
          part.state === "output-available"
        ) {
          found.push({
            kind: "card",
            slugs: askedOnCard(part.output).map((row) => row.slug),
          });
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
  return found
    .map((step) => {
      switch (step.kind) {
        case "card":
          return `connect_app (${step.slugs.join(", ")})`;
        case "note":
          return `note (${step.apps.join(", ")})`;
        case "text":
          return `text: ${step.text.slice(0, 160)}`;
      }
    })
    .join(" | ");
}

const oneCall: Assertion = {
  check: ({ sessions }) => {
    const text = "asked for all four apps in one connect_app call";
    const found = steps(sessions);
    const cards = found.filter((step) => step.kind === "card");
    return {
      evidence: describe(found),
      passed:
        cards.length === 1 &&
        APPS.every((app) => cards[0]?.slugs.includes(app.slug)),
      text,
    };
  },
  text: "asked for all four apps in one connect_app call",
};

const wokenOnce: Assertion = {
  check: ({ sessions }) => {
    const text =
      "was woken once, by a note carrying every app on the card, and said nothing between the card and it";
    const found = steps(sessions);
    const notes = found.filter((step) => step.kind === "note");
    const card = found.findIndex((step) => step.kind === "card");
    const note = found.findIndex((step) => step.kind === "note");
    // The one line the card's own turn ends on is allowed; a line after it
    // and before the note would be a status line of its own.
    const between = found
      .slice(card + 1, note)
      .filter((step) => step.kind === "text");
    return {
      evidence: describe(found),
      passed:
        notes.length === 1 &&
        APPS.every((app) => notes[0]?.apps.includes(app.slug)) &&
        between.length <= 1,
      text,
    };
  },
  text: "was woken once, by a note carrying every app on the card, and said nothing between the card and it",
};

const reply: Assertion = {
  check: ({ sessions }) => {
    const text =
      "answered the note naming what connected and what was skipped, without restating the count";
    const found = steps(sessions);
    const note = found.findIndex((step) => step.kind === "note");
    const said = found
      .slice(note + 1)
      .flatMap((step) => (step.kind === "text" ? [step.text] : []))
      .join("\n");
    return {
      evidence: said.slice(0, 400) || "no reply",
      passed:
        note !== -1 &&
        APPS.every((app) => app.word.test(said)) &&
        /\bskip/i.test(said) &&
        !COUNT.test(said),
      text,
    };
  },
  text: "answered the note naming what connected and what was skipped, without restating the count",
};

export const APP_SIGN_IN_CARD_EVALS = [
  defineEval({
    apps: APPS.map(({ name, slug }) => ({
      kind: "sign-in" as const,
      name,
      slug,
    })),
    assertions: [oneCall, wokenOnce, reply],
    kind: "chat",
    name: "app-sign-in-card",
    prompt:
      "I'm planning next week's team offsite. Connect my Google Drive, Google Docs, Google Calendar and Gmail so you can pull the plan together. Just get them connected for now; I'll say what to do once they're in.",
    signInsAnswerAs: { [SKIPPED]: "declined" },
  }),
];
