/**
 * When a service set up on the web has gained a direct sign-in, does the agent
 * move it there when asked?
 *
 * Gmail is set up and signed in as a web app, as one from before the
 * directory had its sign-in is. The user asks for a way that does not go
 * through the page, and calls it MCP, which the directory has no server for.
 * Scored: the agent moved Gmail to the sign-in the directory has and put its
 * card up.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

const SLUG = "gmail";
const MOVE = new RegExp(
  String.raw`\bapp\s+new\s+${SLUG}\b(?=[^\n]*--force)(?=[^\n]*--api\s)`,
);

type Step =
  | { command: string; kind: "move"; wrote: boolean }
  | { kind: "card"; slugs: string[] }
  | { kind: "text"; text: string };

/** What the chat did about Gmail, in order, as far as this case reads it. */
function steps(sessions: Session.WithMessagesAndParts[]): Step[] {
  const found: Step[] = [];
  for (const session of sessions) {
    if (session.parentId) {
      continue;
    }
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "tool-connect_app") {
          found.push({
            kind: "card",
            slugs: (part.input?.slugs ?? []).filter(
              (slug) => slug !== undefined,
            ),
          });
        } else if (part.type === "tool-bash") {
          const command = String(part.input?.command ?? "");
          if (MOVE.test(command)) {
            found.push({
              command,
              kind: "move",
              wrote:
                "output" in part &&
                JSON.stringify(part.output ?? "").includes(`Wrote ${SLUG}`),
            });
          }
        } else if (message.role === "assistant" && part.type === "text") {
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
          case "card":
            return `connect_app ${step.slugs.join(", ")}`;
          case "move":
            return `move${step.wrote ? "" : " (failed)"}: ${step.command.slice(0, 160)}`;
          case "text":
            return `text: ${step.text.slice(0, 160)}`;
        }
      })
      .join(" | ") || "nothing"
  );
}

const movesIt: Assertion = {
  check: ({ sessions }) => {
    const text = "moved Gmail to the directory's direct sign-in";
    const found = steps(sessions);
    return {
      evidence: describe(found),
      passed: found.some((step) => step.kind === "move" && step.wrote),
      text,
    };
  },
  text: "moved Gmail to the directory's direct sign-in",
};

const asksToSignIn: Assertion = {
  check: ({ sessions }) => {
    const text = "put Gmail's sign-in card up after the move";
    const found = steps(sessions);
    const move = found.findIndex((step) => step.kind === "move" && step.wrote);
    return {
      evidence: describe(found),
      passed:
        move !== -1 &&
        found
          .slice(move)
          .some((step) => step.kind === "card" && step.slugs.includes(SLUG)),
      text,
    };
  },
  text: "put Gmail's sign-in card up after the move",
};

export const APP_OFF_THE_WEB_EVALS = [
  defineEval({
    apps: [
      {
        account: "work@example.com",
        kind: "web",
        name: "Gmail",
        slug: SLUG,
        url: "https://mail.google.com",
      },
    ],
    assertions: [movesIt, asksToSignIn],
    kind: "chat",
    name: "app-off-the-web",
    prompt:
      "I don't want you clicking around in Gmail's page. Switch my Gmail to the MCP, or whatever connects to it directly.",
  }),
];
