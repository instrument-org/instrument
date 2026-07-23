import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";

// Exercises the agent's choice between the Instrument task browser (bare
// agent-browser commands) and external browsers (per-invocation targeting
// flags: --profile, --auto-connect, --cdp, --provider). Cases stop at the
// first relevant invocation where possible, so assertions read the command
// the agent chose without depending on browser output. Execution may still
// race the stop; external cases can briefly launch a real local Chrome.

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

const usedTaskBrowserOnly: Assertion = {
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
      text: "Drove the task browser with no external targeting flags",
    };
  },
  text: "Drove the task browser with no external targeting flags",
};

const usedProfileForLogins: Assertion = {
  check: ({ sessions }) => {
    const commands = agentBrowserCommands(sessions);
    // Reaching the login requires opening a page under the profile. A bare
    // `profiles` listing only discovers profile names and never touches the
    // logged-in state, so it does not count on its own.
    const profileCommands = commands.filter((command) =>
      command.includes("--profile"),
    );
    const bareOpens = commands.filter(
      (command) =>
        /\bopen\b/.test(command) && !EXTERNAL_FLAG_PATTERN.test(command),
    );
    // Asking the user before touching their logged-in browser is also a
    // correct outcome per the skill, so no browsing at all passes.
    const passed =
      commands.length === 0 ||
      (profileCommands.length > 0 && bareOpens.length === 0);
    return {
      evidence:
        commands.length === 0
          ? "No agent-browser invocations (agent deferred to the user)"
          : `Profile-flow: ${profileCommands.join(" | ") || "(none)"}; bare opens: ${bareOpens.join(" | ") || "(none)"}`,
      passed,
      text: "Reached the user's logins via --profile, not the task browser",
    };
  },
  text: "Reached the user's logins via --profile, not the task browser",
};

const usedCdpTarget: Assertion = {
  check: ({ sessions }) => {
    const commands = agentBrowserCommands(sessions);
    const cdp = commands.filter(
      (command) => command.includes("--cdp") && command.includes("9222"),
    );
    return {
      evidence:
        cdp.length > 0
          ? `CDP invocations: ${cdp.join(" | ")}`
          : `No --cdp 9222 invocation. Saw: ${commands.join(" | ") || "(none)"}`,
      passed: cdp.length > 0,
      text: "Targeted the debug Chromium with --cdp 9222",
    };
  },
  text: "Targeted the debug Chromium with --cdp 9222",
};

const listedProfiles: Assertion = {
  check: ({ sessions }) => {
    const commands = agentBrowserCommands(sessions);
    const profiles = commands.filter((command) =>
      /agent-browser\s+profiles\b/.test(command),
    );
    return {
      evidence:
        profiles.length > 0
          ? `profiles invocations: ${profiles.join(" | ")}`
          : `No profiles invocation. Saw: ${commands.join(" | ") || "(none)"}`,
      passed: profiles.length > 0,
      text: "Listed Chrome profiles with the profiles subcommand",
    };
  },
  text: "Listed Chrome profiles with the profiles subcommand",
};

export const BROWSER_SELECTION_EVALS = [
  // Clean research must stay on the managed task browser.
  defineEval({
    assertions: [usedTaskBrowserOnly],
    name: "browser-task-research",
    prompt:
      "Open https://example.com in the browser and tell me the exact page title.",
    shouldStop: stopOnAgentBrowser((command) => /\bopen\b/.test(command)),
  }),
  // Local app work must stay on the managed task browser.
  defineEval({
    assertions: [usedTaskBrowserOnly],
    name: "browser-task-localhost",
    prompt:
      "Open http://localhost:5173 in a browser and describe what the page shows.",
    shouldStop: stopOnAgentBrowser((command) => /\bopen\b/.test(command)),
  }),
  // Explicit CDP endpoint must route via --cdp.
  defineEval({
    assertions: [usedCdpTarget],
    name: "browser-external-cdp",
    prompt:
      "A Chromium instance is running with remote debugging on port 9222. Connect to it and report the URL of its current tab.",
    shouldStop: stopOnAgentBrowser((command) => command.includes("--cdp")),
  }),
  // The user's logged-in state must go through --profile, never a bare open.
  defineEval({
    assertions: [usedProfileForLogins],
    name: "browser-external-logins",
    prompt:
      "Using my existing Chrome browser logins, check whether I'm signed in to github.com and tell me the username shown.",
    shouldStop: stopOnAgentBrowser((command) => command.includes("--profile")),
  }),
  // Host profile discovery works bare (routed external by the harness).
  defineEval({
    assertions: [listedProfiles],
    name: "browser-profiles-listing",
    prompt: "List the Chrome profiles available on this machine.",
    shouldStop: stopOnAgentBrowser((command) => /\bprofiles\b/.test(command)),
  }),
];
