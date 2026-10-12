/**
 * How a task works a connected MCP app when a question takes many calls.
 *
 * `app call` runs one tool per command, so a question across a tracker (the
 * open bugs, then each one's comments) is a turn per call, or a bash loop over
 * `app call`, or `--out` files read back with jq. A `js-exec` script can call
 * the same tools as values through `tools.<slug>.<tool>()` and do the whole
 * fan-out in one command. These cases score the answer, and record which of
 * those the model reached for: the fan-out and the cross-tool join should get
 * cheaper with a script, and the single lookup should stay one plain call
 * rather than grow a script it does not need.
 *
 * The tracker is `evals/lib/mcp-tracker.ts`, generated from a fixed seed, so
 * the expected answers are computed from the same data the server serves.
 */
import { counting } from "radashi";

import { type Session } from "../../src/schemas/session";
import { type AppFixture } from "../lib/connected-app";
import { createdIssueUrl, TRACKER } from "../lib/mcp-tracker";
import { type Assertion, defineEval } from "../harness";

// Any issue the case filed, by the address the tracker gave it.
const CREATED_ISSUE_URL = new RegExp(
  createdIssueUrl("BCN-0")
    .replace("BCN-0", String.raw`BCN-\d+`)
    .replaceAll(".", "\\."),
);

const BEACON: AppFixture = { kind: "mcp", name: "Beacon", slug: "beacon" };

function toolInputs(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type.startsWith("tool-") && "input" in part
          ? [JSON.stringify(part.input)]
          : [],
      ),
    ),
  );
}

function bashCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        return command === undefined ? [] : [command];
      }),
    ),
  );
}

function replyText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

function mentions(text: string, id: string): boolean {
  return new RegExp(`\\b${id}\\b`).test(text);
}

/** What reached the user names a filed issue by the address Beacon returned. */
const linksTheFiledIssue: Assertion = {
  check: ({ sessions }) => {
    const text = "links the issue it filed by the address Beacon returned";
    const reply = replyText(sessions);
    const url = reply.match(CREATED_ISSUE_URL)?.[0];
    return url
      ? { evidence: url, passed: true, text }
      : { evidence: reply.slice(-200), passed: false, text };
  },
  text: "links the issue it filed by the address Beacon returned",
};

const TOOLS_CALL = /\btools(?:\.[a-z]|\[["'])/;

/**
 * Always passes: the evidence line is the record of how the calls were made,
 * which is what comparing runs reads.
 */
const mechanism: Assertion = {
  check: ({ sessions }) => {
    const commands = bashCommands(sessions);
    const scripted = toolInputs(sessions).filter((input) =>
      TOOLS_CALL.test(input),
    ).length;
    const appCalls = commands.filter((command) => /\bapp call\b/.test(command));
    const outs = appCalls.filter((command) => /--out\b/.test(command)).length;
    const loops = appCalls.filter((command) =>
      /\b(?:for|while)\b/.test(command),
    ).length;
    return {
      evidence: `bash ${commands.length}, app call commands ${appCalls.length} (${outs} with --out, ${loops} in a loop), tools.* in a script ${scripted}`,
      passed: true,
      text: "records the mechanism",
    };
  },
  text: "records the mechanism",
};

const noScript: Assertion = {
  check: ({ sessions }) => {
    const scripted = toolInputs(sessions).filter(
      (input) => TOOLS_CALL.test(input) || /js-exec|\bnode\b/.test(input),
    );
    return {
      evidence:
        scripted.length === 0
          ? `bash: ${bashCommands(sessions).join(" | ").slice(0, 300)}`
          : `scripted: ${(scripted[0] ?? "").slice(0, 300)}`,
      passed: scripted.length === 0,
      text: "answers a single lookup without a script",
    };
  },
  text: "answers a single lookup without a script",
};

function answers(
  text: string,
  check: (reply: string) => { missing: string[]; wrong: string[] },
): Assertion {
  return {
    check: ({ sessions }) => {
      const reply = replyText(sessions);
      const { missing, wrong } = check(reply);
      return {
        evidence:
          missing.length === 0 && wrong.length === 0
            ? "all there"
            : `missing: ${missing.join(", ") || "none"}; wrong: ${wrong.join(", ") || "none"}; reply: ${reply.slice(-400)}`,
        passed: missing.length === 0 && wrong.length === 0,
        text,
      };
    },
    text,
  };
}

const open = TRACKER.issues.filter((issue) => issue.state === "open");
const openBugs = open.filter((issue) => issue.labels.includes("bug"));
const labelCounts = Object.entries(
  counting(
    open.flatMap((issue) => issue.labels),
    (label) => label,
  ),
)
  .map(([label, count]) => ({ count, label }))
  .toSorted((a, b) => b.count - a.count);
const topLabels = labelCounts.slice(0, 3);
const busyBugs = openBugs.filter((issue) => issue.comments.length > 3);
// The ones a count that is off by one would let in.
const nearMisses = openBugs.filter((issue) => issue.comments.length === 3);

const lookedUp = TRACKER.issues.find((issue) => issue.id === "BCN-42");
const lookedUpAssignee = TRACKER.users.find(
  (user) => user.id === lookedUp?.assigneeId,
);

const urgentByTeam = Object.entries(
  counting(
    open.filter((issue) => issue.priority === "urgent"),
    (issue) =>
      TRACKER.users.find((user) => user.id === issue.assigneeId)?.team ??
      "unassigned",
  ),
).map(([team, count]) => ({ count, team }));

export const APP_SCRIPTING_EVALS = [
  defineEval({
    apps: [BEACON],
    assertions: [
      answers("names the three busiest labels with their counts", (reply) => ({
        missing: topLabels
          .filter(
            ({ count, label }) =>
              !new RegExp(`\\b${label}\\b[^\\n]{0,60}\\b${count}\\b`, "i").test(
                reply,
              ),
          )
          .map(({ count, label }) => `${label} ${count}`),
        wrong: [],
      })),
      answers(
        "lists exactly the open bugs with more than 3 comments",
        (reply) => ({
          missing: busyBugs
            .filter((issue) => !mentions(reply, issue.id))
            .map((issue) => issue.id),
          // A near miss named as left out ("BCN-9 has exactly 3, so not
          // counted") is right; one named anywhere else is not.
          wrong: nearMisses
            .filter((issue) =>
              reply
                .split("\n")
                .some(
                  (line) =>
                    mentions(line, issue.id) &&
                    !/exclu|exactly 3|at 3\b|only 3\b|not (?:more|over)/i.test(
                      line,
                    ),
                ),
            )
            .map((issue) => issue.id),
        }),
      ),
      mechanism,
    ],
    name: "app-scripting-fans-out-over-a-tracker",
    prompt:
      "Using our Beacon tracker: which three labels have the most open issues (with counts), and which open bugs have more than 3 comments?",
  }),
  defineEval({
    apps: [BEACON],
    assertions: [
      answers("gives the issue's title and assignee", (reply) => ({
        missing: [
          ...(/dark mode/i.test(reply) ? [] : ["title"]),
          ...(lookedUpAssignee && reply.includes(lookedUpAssignee.name)
            ? []
            : [lookedUpAssignee?.name ?? "assignee"]),
        ],
        wrong: [],
      })),
      noScript,
      mechanism,
    ],
    name: "app-scripting-single-lookup",
    prompt: "In Beacon, what is BCN-42 and who is it assigned to?",
  }),
  defineEval({
    apps: [BEACON],
    assertions: [
      answers("counts open urgent issues per team", (reply) => {
        const lines = reply.split("\n");
        return {
          missing: urgentByTeam
            .filter(
              ({ count, team }) =>
                !lines.some(
                  (line) =>
                    line.includes(team) &&
                    new RegExp(`\\b${count}\\b`).test(line),
                ),
            )
            .map(({ count, team }) => `${team} ${count}`),
          wrong: [],
        };
      }),
      mechanism,
    ],
    name: "app-scripting-joins-across-tools",
    prompt:
      "In Beacon, how many open urgent issues does each team have assigned to its members?",
  }),
  defineEval({
    apps: [BEACON],
    assertions: [linksTheFiledIssue],
    name: "app-links-what-it-changed",
    prompt:
      "File a bug in Beacon: the export button does nothing in Safari. Put it on Aiko.",
  }),
  defineEval({
    apps: [BEACON],
    assertions: [linksTheFiledIssue],
    name: "app-links-what-a-fork-changed",
    prompt:
      "In the background, go through these and file each as a bug in Beacon, on Aiko: the export button does nothing in Safari; dark mode loses the sidebar icons; CSV import drops the last row.",
  }),
];
