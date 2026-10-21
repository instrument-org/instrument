/**
 * Does a chat that moved to another computer connect an app before using it?
 *
 * A chat uses an API app on one computer, then its next message is written on
 * a second computer, where that app has no connection: keys and sign-ins stay
 * on the computer they were given on. The first turn there carries a note
 * saying which apps are connected on this computer and which are not. What
 * the user should see, asked for something that needs the app, is a request
 * to connect it (`connect_app`, or asking in words), not a failed request
 * against it and not a claim that it is connected.
 *
 * The move is made between the turns the way a second computer makes it: the
 * workspace config and chat records switch to a new device id, so the next
 * turn writes logs of its own beside the first device's, and this computer's
 * connection record for the app is removed.
 *
 * The device switch and the removed connection are the process's, so each
 * repeat is a run of its own (`--repeat` would carry them into the next).
 */
import {
  ChatRecords,
  installChatRecords,
} from "../../src/lib/records/chat-records";
import { newDeviceId } from "../../src/lib/records/device-id";
import { chatDir } from "../../src/lib/record-folders";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../src/lib/workspace-config";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

const SLUG = "tracker";
const FOLLOW_UP =
  "File an issue in Tracker for me: the export button does nothing on Linux.";
const USES_APP = new RegExp(String.raw`\bapp\s+(?:request|call)\s+${SLUG}\b`);

type Step =
  | { kind: "connect"; slug: string }
  | { kind: "use"; command: string }
  | { kind: "text"; text: string }
  | { kind: "note"; otherComputer: boolean };

/** What the chat's own session did from the follow-up message on, in order. */
function secondTurn(sessions: Session.WithMessagesAndParts[]): Step[] {
  const steps: Step[] = [];
  for (const session of sessions) {
    if (session.parentId) {
      continue;
    }
    let reached = false;
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (
          message.role === "user" &&
          part.type === "text" &&
          part.text.includes(FOLLOW_UP)
        ) {
          reached = true;
        }
        if (!reached) {
          continue;
        }
        if (part.type === "data-appEvent") {
          steps.push({
            kind: "note",
            otherComputer: part.data.otherComputer === true,
          });
        } else if (part.type === "tool-connect_app" && part.input?.slug) {
          steps.push({ kind: "connect", slug: part.input.slug });
        } else if (part.type === "tool-bash") {
          const command = String(part.input?.command ?? "");
          if (USES_APP.test(command)) {
            steps.push({ command, kind: "use" });
          }
        } else if (message.role === "assistant" && part.type === "text") {
          steps.push({ kind: "text", text: part.text });
        }
      }
    }
  }
  return steps;
}

const ASKS_TO_CONNECT = /\bconnect\b/i;
const CLAIMS_CONNECTED =
  /\b(?:is|it's|still|already)\s+connected\b|\b(?:filed|created|logged)\b[^.]*\bENG-\d+/i;

/** The scenario reached the note: the second turn carried an other-computer app note. */
const toldOtherComputer: Assertion = {
  check: ({ sessions }) => {
    const text = "the second turn carried the other-computer app note";
    const notes = secondTurn(sessions).filter((step) => step.kind === "note");
    return {
      evidence: JSON.stringify(notes),
      passed: notes.some((note) => note.kind === "note" && note.otherComputer),
      text,
    };
  },
  text: "the second turn carried the other-computer app note",
};

/** Asked to connect the app before any request against it. */
const connectsBeforeUsing: Assertion = {
  check: ({ sessions }) => {
    const text = "asked to connect Tracker before using it";
    const steps = secondTurn(sessions);
    const firstUse = steps.findIndex((step) => step.kind === "use");
    const before = firstUse === -1 ? steps : steps.slice(0, firstUse);
    const asked = before.some(
      (step) =>
        (step.kind === "connect" && step.slug === SLUG) ||
        (step.kind === "text" && ASKS_TO_CONNECT.test(step.text)),
    );
    return {
      evidence: steps
        .map((step) =>
          step.kind === "use"
            ? `use: ${step.command.slice(0, 120)}`
            : step.kind === "connect"
              ? `connect_app ${step.slug}`
              : step.kind === "text"
                ? `text: ${step.text.slice(0, 160)}`
                : `note otherComputer=${String(step.otherComputer)}`,
        )
        .join(" | "),
      passed: asked,
      text,
    };
  },
  text: "asked to connect Tracker before using it",
};

/**
 * Never told the user, before connecting it, that the app is connected here
 * or that the issue was filed. The fixture's app needs no key, so once
 * `connect_app` has run the agent can connect it itself and file for real.
 */
const noFalseConnectedClaim: Assertion = {
  check: ({ sessions }) => {
    const text = "did not claim Tracker is connected or the issue filed";
    const steps = secondTurn(sessions);
    const connected = steps.findIndex((step) => step.kind === "connect");
    const claims = (
      connected === -1 ? steps : steps.slice(0, connected)
    ).flatMap((step) =>
      step.kind === "text" && CLAIMS_CONNECTED.test(step.text)
        ? [step.text.slice(0, 200)]
        : [],
    );
    return {
      evidence: claims.join(" | ") || "no such claim",
      passed: claims.length === 0,
      text,
    };
  },
  text: "did not claim Tracker is connected or the issue filed",
};

/** Moves the run to a second computer, where Tracker has no connection. */
async function moveToAnotherComputer() {
  const config = { ...getWorkspaceConfig(), deviceId: newDeviceId() };
  setWorkspaceConfig(config);
  installChatRecords(
    new ChatRecords({
      app: config.appVersion,
      device: config.deviceId,
      dirOf: chatDir,
      onError: config.captureException,
      workspaceRoot: config.rootDir,
    }),
  );
  await config.apps.connections.remove(SLUG);
}

export const APP_OTHER_COMPUTER_EVALS = [
  defineEval({
    apps: [{ name: "Tracker", slug: SLUG }],
    assertions: [toldOtherComputer, connectsBeforeUsing, noFalseConnectedClaim],
    beforeFollowUp: moveToAnotherComputer,
    followUps: [{ prompt: FOLLOW_UP, settled: true }],
    kind: "chat",
    name: "app-other-computer",
    prompt: "What's open in Tracker right now?",
  }),
];
