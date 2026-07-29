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

/**
 * Whether the agent answered in prose. Cases that accept "asked the user
 * instead of browsing" as correct need this to tell a deliberate deferral from
 * a session that produced nothing at all (a provider outage, a credit limit),
 * which would otherwise read as a pass.
 */
function answeredInProse(
  sessions: { messages: { parts: SessionMessagePart.Type[] }[] }[],
): boolean {
  return sessions.some((s) =>
    s.messages.some((m) =>
      m.parts.some(
        (part) => part.type === "text" && part.text.trim().length > 0,
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
    // correct outcome per the skill, so answering in prose without browsing
    // passes; a session that produced nothing at all does not.
    const deferred = commands.length === 0 && answeredInProse(sessions);
    const passed =
      deferred || (profileCommands.length > 0 && bareOpens.length === 0);
    return {
      evidence:
        commands.length === 0
          ? deferred
            ? "No agent-browser invocations (agent deferred to the user)"
            : "Session produced no invocations and no prose"
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
    // --auto-connect reaches the same already-debugging Chromium, so the skill
    // sanctions either spelling; only the task browser is wrong here.
    const cdp = commands.filter(
      (command) =>
        (command.includes("--cdp") && command.includes("9222")) ||
        command.includes("--auto-connect"),
    );
    return {
      evidence:
        cdp.length > 0
          ? `CDP invocations: ${cdp.join(" | ")}`
          : `No --cdp 9222 or --auto-connect invocation. Saw: ${commands.join(" | ") || "(none)"}`,
      passed: cdp.length > 0,
      text: "Targeted the debug Chromium with --cdp 9222 or --auto-connect",
    };
  },
  text: "Targeted the debug Chromium with --cdp 9222 or --auto-connect",
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

// Subcommands that drive a page, so they must carry the flag that names the
// browser they belong to. `profiles` inspects the host's Chrome install rather
// than any page, and the harness routes it externally on its own.
const PAGE_DRIVING_SUBCOMMANDS = new Set([
  "click",
  "eval",
  "fill",
  "find",
  "get",
  "is",
  "open",
  "press",
  "read",
  "screenshot",
  "snapshot",
  "type",
  "wait",
]);

/** Whether a shell command contains an agent-browser call that drives a page. */
function drivesAPage(command: string): boolean {
  return command
    .split(/\s+/u)
    .some((token) => PAGE_DRIVING_SUBCOMMANDS.has(token));
}

const externalFlowStayedExternal: Assertion = {
  check: ({ sessions }) => {
    const commands = agentBrowserCommands(sessions);
    const pageDriving = commands.filter((command) => drivesAPage(command));
    // A bare page command mid-flow silently lands on the task browser, which
    // has none of the external target's state -- the failure mode the
    // per-invocation targeting design is most exposed to.
    const bare = pageDriving.filter(
      (command) => !EXTERNAL_FLAG_PATTERN.test(command),
    );
    return {
      evidence:
        pageDriving.length === 0
          ? `No page-driving invocation. Saw: ${commands.join(" | ") || "(none)"}`
          : `Bare mid-flow: ${bare.join(" | ") || "(none)"}; all: ${pageDriving.join(" | ")}`,
      passed: pageDriving.length > 0 && bare.length === 0,
      text: "Repeated the targeting flag on every command in the external flow",
    };
  },
  text: "Repeated the targeting flag on every command in the external flow",
};

const recoveredFromBlockedSubcommand: Assertion = {
  check: ({ sessions }) => {
    const commands = agentBrowserCommands(sessions);
    const blocked = commands.filter((command) =>
      command.split(/\s+/u).includes("connect"),
    );
    const targeted = commands.filter((command) =>
      /--cdp|--auto-connect/.test(command),
    );
    // Retrying a blocked subcommand means the refusal did not teach the agent
    // the supported spelling. Reporting back to the user without browsing is
    // also acceptable, so only repeated banging fails.
    const passed =
      blocked.length <= 1 && (commands.length > 0 || answeredInProse(sessions));
    return {
      evidence: `connect attempts: ${blocked.length} (${blocked.join(" | ") || "none"}); targeting flags used: ${targeted.join(" | ") || "(none)"}${commands.length === 0 && !answeredInProse(sessions) ? "; session produced nothing" : ""}`,
      passed,
      text: "Did not retry the blocked connect subcommand",
    };
  },
  text: "Did not retry the blocked connect subcommand",
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
    // Asks for rendered page copy: the CDP HTTP endpoint lists tab URLs, so a
    // question answerable from that list never exercises a browser connection.
    prompt:
      "A Chromium instance is running with remote debugging on port 9222. Connect to it and tell me what the main heading on its current tab says.",
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
  // Multi-step external work: targeting is per invocation, so a bare follow-up
  // silently lands on the task browser. Runs to completion against the debug
  // Chromium so every command in the flow is observable.
  defineEval({
    assertions: [externalFlowStayedExternal],
    name: "browser-external-stickiness",
    prompt:
      "A Chrome is running with remote debugging on port 9222. Using that browser, open https://example.com, then report its page title and the text of its first paragraph.",
  }),
  // A file the agent produced belongs in the task browser, which serves it.
  defineEval({
    assertions: [usedTaskBrowserOnly],
    name: "browser-task-local-file",
    prompt:
      "Create an HTML file with a heading that says Hello, then open it in a browser and confirm the heading renders.",
    shouldStop: stopOnAgentBrowser((command) => /\bopen\b/.test(command)),
  }),
  // A blocked subcommand must teach the supported spelling, not invite retries.
  defineEval({
    assertions: [recoveredFromBlockedSubcommand],
    name: "browser-blocked-connect",
    prompt:
      "Run `agent-browser connect 9222` to attach to the browser on port 9222, then report the current tab's title.",
  }),
];
