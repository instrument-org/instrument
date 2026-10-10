/**
 * Does a second account of a service come out as that service?
 *
 * With Gmail connected as one account, "connect my personal Gmail" is a
 * second app of the same service. What the user should end up with is two
 * apps both called Gmail, told apart by the account each is signed in as,
 * and a sign-in card that opens Google's page for adding an account rather
 * than the inbox already signed in. `app new` enforces the name and picks
 * the sign-in page; what is scored is that the conversation reaches it: a
 * new app of its own beside the first, and a card asking to sign it in.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

function bashResults(
  sessions: Session.WithMessagesAndParts[],
): { command: string; output: string }[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && part.state === "output-available"
          ? [
              {
                command: String(part.input?.command ?? ""),
                output: JSON.stringify(part.output),
              },
            ]
          : [],
      ),
    ),
  );
}

function connectedSlugs(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-connect_app" && part.input?.slug
          ? [part.input.slug]
          : [],
      ),
    ),
  );
}

const NEW_APP = /(?:^|[\n;&|])\s*app new ([a-z0-9-]+)/;

/** A new app beside the first, set up as another account of Gmail. */
const setUpAnotherAccount: Assertion = {
  check: ({ sessions }) => {
    const text = "set a second Gmail app up beside the first";
    const made = bashResults(sessions).filter(({ command }) =>
      NEW_APP.test(command),
    );
    const another = made.find(
      ({ command, output }) =>
        NEW_APP.exec(command)?.[1] !== "gmail" &&
        output.includes("another Gmail account beside gmail") &&
        output.includes("accounts.google.com/AddSession"),
    );
    return {
      evidence:
        made.map(({ command }) => command.slice(0, 200)).join(" | ") ||
        "no app new",
      passed: another !== undefined,
      text,
    };
  },
  text: "set a second Gmail app up beside the first",
};

/** The card it asked to sign in with is for the new app, not the first. */
const askedToSignInTheNewOne: Assertion = {
  check: ({ sessions }) => {
    const text = "asked to sign in the new app";
    const slugs = connectedSlugs(sessions);
    return {
      evidence: slugs.join(", ") || "no connect_app",
      passed: slugs.length > 0 && slugs.every((slug) => slug !== "gmail"),
      text,
    };
  },
  text: "asked to sign in the new app",
};

export const APP_ACCOUNTS_EVALS = [
  defineEval({
    apps: [
      {
        account: "jeremy@finalpoint.co",
        kind: "web",
        name: "Gmail",
        slug: "gmail",
        url: "https://mail.google.com",
      },
    ],
    assertions: [setUpAnotherAccount, askedToSignInTheNewOne],
    kind: "chat",
    name: "app-second-gmail-account",
    prompt: "Can you also connect my personal Gmail",
  }),
];
