/**
 * Does a task use its browser's tabs when the work is several pages at once,
 * and leave them alone when it is one?
 *
 * The agent-browser skill describes `tab new`, `tab <id>`, `tab list` and
 * `tab close`. What it cannot show is whether a model reaches for them when
 * two pages are one job, whether it snapshots again after a switch instead of
 * clicking refs from the other tab, and whether a one-page question stays one
 * page. A run has no window, so each task browses in a Chrome of its own,
 * which has the same tab commands the app's task browser answers.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/** Every agent-browser command the task ran, in order. */
function browserCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        return command === undefined
          ? []
          : [...command.matchAll(/agent-browser\s+([^\n;&|]+)/g)].map((match) =>
              (match[1] ?? "").trim(),
            );
      }),
    ),
  );
}

const TAB_COMMAND = /^(?:tab\b|window\s+new\b)|--new-tab\b/;

const openedASecondTab: Assertion = {
  check: ({ sessions }) => {
    const tabs = browserCommands(sessions).filter((command) =>
      /^tab\s+new\b|--new-tab\b/.test(command),
    );
    return {
      evidence:
        tabs.length > 0
          ? tabs.join("\n")
          : browserCommands(sessions).join("\n") || "no browser commands",
      passed: tabs.length > 0,
      text: "Opened a second tab for the second page",
    };
  },
  text: "Opened a second tab for the second page",
};

const neverUsedTabs: Assertion = {
  check: ({ sessions }) => {
    const tabs = browserCommands(sessions).filter((command) =>
      TAB_COMMAND.test(command),
    );
    return {
      evidence: tabs.length > 0 ? tabs.join("\n") : "none",
      passed: tabs.length === 0,
      text: "Kept a one-page question to one tab",
    };
  },
  text: "Kept a one-page question to one tab",
};

function answered(pattern: RegExp, text: string): Assertion {
  return {
    check: ({ sessions }) => {
      const last = sessions
        .flatMap((session) => session.messages)
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "text" ? [part.text] : [],
          ),
        )
        .join("\n");
      return {
        evidence: last.slice(-600) || "no reply",
        passed: pattern.test(last),
        text,
      };
    },
    text,
  };
}

export const TASK_TABS_EVALS = [
  defineEval({
    assertions: [
      openedASecondTab,
      answered(/jar/i, "Named the Jar article"),
      answered(/bottle/i, "Named the Bottle article"),
    ],
    name: "task-tabs-compare",
    prompt:
      "Open https://en.wikipedia.org/wiki/Jar and https://en.wikipedia.org/wiki/Bottle side by side in two tabs, leave both open, and tell me which of the two articles has more section headings.",
  }),

  defineEval({
    assertions: [
      neverUsedTabs,
      answered(/example domain/i, "Gave the heading"),
    ],
    name: "task-tabs-single-page",
    prompt: "What is the main heading on https://example.com?",
  }),
];
