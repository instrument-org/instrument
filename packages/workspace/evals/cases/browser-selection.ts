import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";

// Exercises the agent reaching for the in-app browser with bare agent-browser
// commands, never a targeting flag. Cases stop at the first relevant
// invocation, so assertions read the command the agent chose without depending
// on browser output.

const EXTERNAL_FLAG_PATTERN =
  /--(?:cdp|auto-connect|profile|provider|state|restore|executable-path)\b|(?:^|\s)-p\s/;

function agentBrowserCommands(
  sessions: { messages: { parts: SessionMessagePart.Type[] }[] }[],
): string[] {
  return sessions.flatMap((s) =>
    s.messages.flatMap((m) =>
      m.parts
        .map(bashCommand)
        .filter(
          (command): command is string =>
            command?.includes("agent-browser") ?? false,
        ),
    ),
  );
}

function bashCommand(part: SessionMessagePart.Type): string | undefined {
  if (part.type !== "tool-bash" || !("input" in part)) {
    return undefined;
  }
  return part.input?.command;
}

const stopOnAgentBrowser =
  (predicate: (command: string) => boolean) =>
  (part: SessionMessagePart.Type) => {
    if (!("state" in part) || part.state !== "input-available") {
      return false;
    }
    const command = bashCommand(part);
    if (command === undefined) {
      return false;
    }
    return command.includes("agent-browser") && predicate(command);
  };

const usedInAppBrowserOnly: Assertion = {
  check: ({ sessions }) => {
    const commands = agentBrowserCommands(sessions);
    const external = commands.filter((command) =>
      EXTERNAL_FLAG_PATTERN.test(command),
    );
    return {
      evidence:
        commands.length === 0
          ? "No agent-browser invocations found"
          : external.length > 0
            ? `External-flagged invocations: ${external.join(" | ")}`
            : `Invocations: ${commands.join(" | ")}`,
      passed: commands.length > 0 && external.length === 0,
      text: "Drove the in-app browser with no external targeting flags",
    };
  },
  text: "Drove the in-app browser with no external targeting flags",
};

export const BROWSER_SELECTION_EVALS = [
  // Clean research must stay on the in-app browser.
  defineEval({
    assertions: [usedInAppBrowserOnly],
    name: "browser-task-research",
    prompt:
      "Open https://example.com in the browser and tell me the exact page title.",
    shouldStop: stopOnAgentBrowser((command) => /\bopen\b/.test(command)),
  }),
  // Local app work must stay on the in-app browser.
  defineEval({
    assertions: [usedInAppBrowserOnly],
    name: "browser-task-localhost",
    prompt:
      "Open http://localhost:5173 in a browser and describe what the page shows.",
    shouldStop: stopOnAgentBrowser((command) => /\bopen\b/.test(command)),
  }),
  // A file the agent produced belongs in the in-app browser, which serves it.
  defineEval({
    assertions: [usedInAppBrowserOnly],
    name: "browser-task-local-file",
    prompt:
      "Create an HTML file with a heading that says Hello, then open it in a browser and confirm the heading renders.",
    shouldStop: stopOnAgentBrowser((command) => /\bopen\b/.test(command)),
  }),
];
