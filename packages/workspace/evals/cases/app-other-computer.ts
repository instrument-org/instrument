/**
 * Does a chat that moved to another computer connect an app once it finds the
 * app is not connected there?
 *
 * A chat uses an API app on one computer, then its next message is written on
 * a second computer, where that app has no connection: keys and sign-ins stay
 * on the computer they were given on. The first turn there carries a note
 * saying which apps are connected on this computer and which are not. The note
 * states facts and asks nothing; the `app` command's "not connected" refusal
 * is the guard. So a request against the app may come first. What is scored
 * is what follows: after a refusal the agent connects the app (`connect_app`,
 * `app test`, or asking the user in words) rather than giving up or retrying
 * the request, it never claims the app is connected or the issue filed before
 * it is, and the issue is filed once the app is connected.
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
const TESTS_APP = new RegExp(String.raw`\bapp\s+test\s+${SLUG}\b`);
const REFUSED = /is not connected/;
const FILED = /filed\W+true/;

type Step =
  | { kind: "connect"; slug: string }
  | { kind: "test"; passed: boolean }
  | { command: string; filed: boolean; kind: "use"; refused: boolean }
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
        } else if (part.type === "tool-connect_app" && part.input?.slugs) {
          for (const slug of part.input.slugs) {
            if (slug !== undefined) {
              steps.push({ kind: "connect", slug });
            }
          }
        } else if (part.type === "tool-bash") {
          const command = String(part.input?.command ?? "");
          const result = [
            "output" in part ? JSON.stringify(part.output ?? "") : "",
            "errorText" in part ? String(part.errorText ?? "") : "",
          ].join("\n");
          if (USES_APP.test(command)) {
            steps.push({
              command,
              filed: FILED.test(result),
              kind: "use",
              refused: REFUSED.test(result),
            });
          } else if (TESTS_APP.test(command)) {
            steps.push({
              kind: "test",
              passed: /\bis connected\b/.test(result),
            });
          }
        } else if (message.role === "assistant" && part.type === "text") {
          steps.push({ kind: "text", text: part.text });
        }
      }
    }
  }
  return steps;
}

function describe(steps: Step[]): string {
  return steps
    .map((step) => {
      switch (step.kind) {
        case "use":
          return `use${step.refused ? " (refused)" : ""}${step.filed ? " (filed)" : ""}: ${step.command.slice(0, 100)}`;
        case "connect":
          return `connect_app ${step.slug}`;
        case "test":
          return `app test ${step.passed ? "passed" : "failed"}`;
        case "text":
          return `text: ${step.text.slice(0, 160)}`;
        case "note":
          return `note otherComputer=${String(step.otherComputer)}`;
      }
    })
    .join(" | ");
}

/**
 * The first step that shows Tracker connected on this computer. A request that
 * failed on its own flags shows nothing either way.
 */
function connectedAt(steps: Step[]): number {
  return steps.findIndex(
    (step) =>
      (step.kind === "test" && step.passed) ||
      (step.kind === "use" && step.filed),
  );
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

/**
 * Never told the user, before Tracker was connected here, that it is connected
 * or that the issue was filed.
 */
const noFalseConnectedClaim: Assertion = {
  check: ({ sessions }) => {
    const text = "did not claim Tracker is connected or the issue filed early";
    const steps = secondTurn(sessions);
    const connected = connectedAt(steps);
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
  text: "did not claim Tracker is connected or the issue filed early",
};

/**
 * After each "not connected" refusal, the next thing the agent did was connect
 * Tracker or ask the user to, not another request and not a stop.
 */
const connectsAfterRefusal: Assertion = {
  check: ({ sessions }) => {
    const text = "connected Tracker after a not-connected refusal";
    const steps = secondTurn(sessions);
    const failures = steps.flatMap((step, index) => {
      if (step.kind !== "use" || !step.refused) {
        return [];
      }
      const next = steps
        .slice(index + 1)
        .find(
          (later) =>
            later.kind === "use" ||
            later.kind === "connect" ||
            later.kind === "test" ||
            (later.kind === "text" && ASKS_TO_CONNECT.test(later.text)),
        );
      return next && next.kind !== "use" ? [] : [index];
    });
    return {
      evidence: describe(steps),
      passed: failures.length === 0,
      text,
    };
  },
  text: "connected Tracker after a not-connected refusal",
};

/** Once Tracker was connected, the issue was filed. */
const filesOnceConnected: Assertion = {
  check: ({ sessions }) => {
    const text = "filed the issue once Tracker was connected";
    const steps = secondTurn(sessions);
    return {
      evidence: describe(steps),
      passed: steps.some((step) => step.kind === "use" && step.filed),
      text,
    };
  },
  text: "filed the issue once Tracker was connected",
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
    assertions: [
      toldOtherComputer,
      noFalseConnectedClaim,
      connectsAfterRefusal,
      filesOnceConnected,
    ],
    beforeFollowUp: moveToAnotherComputer,
    followUps: [{ prompt: FOLLOW_UP, settled: true }],
    kind: "chat",
    name: "app-other-computer",
    prompt: "What's open in Tracker right now?",
  }),
];
