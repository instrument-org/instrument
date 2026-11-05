/**
 * When a service refuses an app's direct sign-in, does the agent explain and
 * leave the next step to the card, rather than stopping as if declined or
 * asking a second time?
 *
 * The user asks to connect Linear; the agent sets it up and puts a sign-in
 * card up. The run then ends that sign-in the way the app's callback does
 * when the service turns the account away (`signInsEndAs`), which wakes the
 * chat with a note saying the card now offers the service's site. Scored: the
 * note arrived, the agent said so in a line, it neither moved the app to the
 * web itself nor called `connect_app` again, and it never told the user they
 * declined.
 */
import { type Session } from "../../src/schemas/session";
import { connectAppResults } from "../../src/tools/connect-app-output";
import { type Assertion, defineEval } from "../harness";

const SLUG = "linear";
const TO_WEB = new RegExp(
  String.raw`\bapp\s+new\s+${SLUG}\b[^\n]*--web\s+\S+[^\n]*--force|\bapp\s+new\s+${SLUG}\b[^\n]*--force[^\n]*--web\s`,
);
const SAYS_DECLINED = /\b(?:you|user)\s+(?:have\s+)?declined\b/i;

type Step =
  | { kind: "card"; card: string | undefined }
  | { kind: "note"; ended: string | undefined }
  | { command: string; kind: "to-web"; wrote: boolean }
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
        if (part.type === "data-appEvent") {
          const event = part.data.events.find((each) => each.slug === SLUG);
          if (event) {
            found.push({ ended: event.signIn?.ended, kind: "note" });
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
          if (TO_WEB.test(command)) {
            found.push({
              command,
              kind: "to-web",
              wrote:
                "output" in part &&
                JSON.stringify(part.output ?? "").includes("Wrote "),
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
  return found
    .map((step) => {
      switch (step.kind) {
        case "card":
          return `connect_app (${step.card ?? "?"})`;
        case "note":
          return `note (${step.ended ?? "no sign-in end"})`;
        case "to-web":
          return `to web${step.wrote ? "" : " (failed)"}: ${step.command.slice(0, 120)}`;
        case "text":
          return `text: ${step.text.slice(0, 160)}`;
      }
    })
    .join(" | ");
}

const noteAt = (found: Step[]) =>
  found.findIndex((step) => step.kind === "note" && step.ended === "refused");

/** The scenario reached the refusal: a sign-in card, then the refused note. */
const reachedRefusal: Assertion = {
  check: ({ sessions }) => {
    const text = "put a sign-in card up and was woken by the refusal";
    const found = steps(sessions);
    const note = noteAt(found);
    return {
      evidence: describe(found),
      passed:
        note > 0 &&
        found
          .slice(0, note)
          .some((step) => step.kind === "card" && step.card === "sign-in"),
      text,
    };
  },
  text: "put a sign-in card up and was woken by the refusal",
};

/** After the note, said so and left the next step to the card it already has. */
const leavesItToTheCard: Assertion = {
  check: ({ sessions }) => {
    const text = "explained in a line and left the next step to the card";
    const found = steps(sessions);
    const after = found.slice(noteAt(found) + 1);
    return {
      evidence: describe(after),
      passed:
        noteAt(found) !== -1 &&
        after.some((step) => step.kind === "text") &&
        !after.some((step) => step.kind === "to-web" || step.kind === "card"),
      text,
    };
  },
  text: "explained in a line and left the next step to the card",
};

/** Never told the user they declined: the service refused, not them. */
const neverSaysDeclined: Assertion = {
  check: ({ sessions }) => {
    const text = "never said the user declined";
    const found = steps(sessions);
    const said = found
      .slice(noteAt(found) + 1)
      .flatMap((step) =>
        step.kind === "text" && SAYS_DECLINED.test(step.text)
          ? [step.text.slice(0, 200)]
          : [],
      );
    return {
      evidence: said.join(" | ") || "no such line",
      passed: said.length === 0,
      text,
    };
  },
  text: "never said the user declined",
};

export const APP_SIGN_IN_REFUSED_EVALS = [
  defineEval({
    assertions: [reachedRefusal, leavesItToTheCard, neverSaysDeclined],
    kind: "chat",
    name: "app-sign-in-refused",
    prompt: "Connect my Linear so you can see what's assigned to me.",
    signInsEndAs: {
      detail:
        "access_denied: Your workspace admin has not approved this application.",
      ended: "refused",
    },
  }),
];
