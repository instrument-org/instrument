import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/**
 * File discovery across an attached folder large enough to exceed the
 * sandbox's traversal budget. `find`, `ls -R`, `du` and `grep -r` are just-bash
 * builtins interpreted on the Electron main thread and bounded by
 * `maxTraversalEntries`; `rg` is the real binary in a subprocess and is bounded
 * by nothing. Over a tree this size the builtins therefore cannot answer at
 * all: they walk until the budget is spent and exit 126 with no results, while
 * `rg --files` returns the whole list.
 *
 * What is measured is which of the two the model reaches for first, and whether
 * it recovers when the builtin refuses. The folder is supplied by
 * `LARGE_FOLDER_EVAL_PATH` so the case carries no machine path; without it the
 * case is skipped rather than silently measuring a small tree.
 */
const FOLDER = process.env.LARGE_FOLDER_EVAL_PATH;

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

function bashOutcomes(sessions: Session.WithMessagesAndParts[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && part.output
          ? [
              {
                command: part.input.command,
                durationMs: part.output.durationMs,
                text: part.output.output,
              },
            ]
          : [],
      ),
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

/** The search that can actually answer over a tree this size. */
const usedRipgrepToList: Assertion = {
  check: ({ sessions }) => {
    const runs = bashCommands(sessions).filter((command) =>
      /(?:^|[\s;&|(])rg\s/.test(command),
    );
    return {
      evidence:
        runs.length > 0
          ? `rg ran ${runs.length}x, first: ${(runs[0] ?? "").slice(0, 160)}`
          : `Never ran rg. Commands: ${bashCommands(sessions).join(" | ").slice(0, 400)}`,
      passed: runs.length > 0,
      text: "reached for rg",
    };
  },
  text: "reached for rg",
};

/**
 * A builtin traversal over the mount spends the budget and returns nothing.
 * Matched on the limit message rather than on exit 126, which the shell also
 * uses for a command it could not run at all.
 */
const noBudgetExhaustedTraversal: Assertion = {
  check: ({ sessions }) => {
    const burned = bashOutcomes(sessions).filter((run) =>
      /(?:traversal|glob) (?:work |operation )?limit exceeded/.test(run.text),
    );
    const wasted = burned.reduce((total, run) => total + run.durationMs, 0)
    return {
      evidence:
        burned.length === 0
          ? "No traversal exhausted its budget"
          : `${burned.length} call(s) spent the traversal budget for nothing, ${(wasted / 1000).toFixed(1)}s total: ${burned.map((run) => run.command.slice(0, 80)).join(" | ")}`,
      passed: burned.length === 0,
      text: "never burned the traversal budget",
    };
  },
  text: "never burned the traversal budget",
};

/** An answer at all: the count only a completed listing can produce. */
const answeredWithACount: Assertion = {
  check: ({ sessions }) => {
    const text = replyText(sessions);
    const hasNumber = /\b\d{2,}\b/.test(text);
    return {
      evidence: hasNumber
        ? `Reply carries a count: ${text.slice(0, 200)}`
        : `Reply has no count: ${text.slice(0, 200)}`,
      passed: hasNumber,
      text: "answered with a count",
    };
  },
  text: "answered with a count",
};

/** Any answer at all, rather than a report that the folder could not be read. */
const answeredRatherThanGaveUp: Assertion = {
  check: ({ sessions }) => {
    const text = replyText(sessions).toLowerCase();
    const gaveUp =
      /(?:could not|couldn't|unable to|cannot) (?:read|list|scan|traverse|search|analy)/.test(
        text,
      ) || /traversal (?:work )?limit/.test(text);
    return {
      evidence: gaveUp
        ? `Reported failure rather than answering: ${text.slice(0, 200)}`
        : `Answered: ${text.slice(0, 200)}`,
      passed: !gaveUp && text.length > 0,
      text: "answered rather than reporting the limit",
    };
  },
  text: "answered rather than reporting the limit",
};

/**
 * The three shapes a question about a folder takes. Only the first has a
 * native binary behind it, which is the point of running all three: `rg` lists
 * files, and nothing lists directories or measures size except the builtins.
 */
export const LARGE_FOLDER_SEARCH_EVALS = FOLDER
  ? [
      defineEval({
        assertions: [
          usedRipgrepToList,
          noBudgetExhaustedTraversal,
          answeredWithACount,
        ],
        folders: [{ access: "read-only", path: FOLDER }],
        name: "large-folder-by-name",
        prompt:
          "In my attached folder, how many files are named SKILL.md? Give me the number and the five shortest paths.",
      }),
      defineEval({
        assertions: [noBudgetExhaustedTraversal, answeredRatherThanGaveUp],
        folders: [{ access: "read-only", path: FOLDER }],
        name: "large-folder-structure",
        prompt:
          "Give me an overview of how my attached folder is organized: what the top-level areas are and roughly what lives under them.",
      }),
      defineEval({
        assertions: [noBudgetExhaustedTraversal, answeredRatherThanGaveUp],
        folders: [{ access: "read-only", path: FOLDER }],
        name: "large-folder-size",
        prompt:
          "How much disk space is my attached folder using, and which parts of it are the biggest?",
      }),
    ]
  : [];
