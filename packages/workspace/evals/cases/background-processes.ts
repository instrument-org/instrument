/**
 * Does a model reach for the background-process commands on its own, and do
 * they work when it does?
 *
 * Backgrounding is not a tool the model can be shown in a tool list: a command
 * goes to the background by outliving `yieldMs`, and everything after that
 * happens through `jobs`, `fg` and `kill`, which the model only learns about
 * from the `bash` description. So there is nothing below a real agent that can
 * tell us whether the affordance is discoverable -- only whether it functions.
 *
 * These measure both, and separately: whether the promotion happened at all,
 * whether the model then used the right command, and whether the command
 * returned the right answer.
 */
import {
  FG_COMMAND,
  JOBS_COMMAND,
  KILL_COMMAND,
} from "../../src/lib/shell-commands/background-jobs";
import { type Session } from "../../src/schemas/session";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";

interface BashCall {
  command: string;
  output: string;
  processId: string | undefined;
}

type Sessions = Session.WithMessagesAndParts[];

/**
 * Every completed `bash` call, flattened to the three things these assertions
 * ask about. A promoted call is the one that carries a `processId`.
 */
function bashCalls(sessions: Sessions): BashCall[] {
  return sessions
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts)
    .flatMap((part) => (isBashCall(part) ? [part] : []))
    .flatMap((part) => {
      const command: unknown = part.input?.command;
      if (typeof command !== "string") {
        return [];
      }
      const output = "output" in part ? part.output : undefined;
      return [
        {
          command,
          output: typeof output?.output === "string" ? output.output : "",
          processId:
            typeof output?.processId === "string"
              ? output.processId
              : undefined,
        },
      ];
    });
}

function describeCommands(calls: BashCall[]): string {
  return calls.length === 0
    ? "(no bash calls)"
    : calls.map((call) => `\`${call.command}\``).join(", ");
}

function isBashCall(
  part: SessionMessagePart.Type,
): part is Extract<SessionMessagePart.Type, { type: "tool-bash" }> {
  return part.type === "tool-bash";
}

/** Ran the named command, as a command rather than as part of a word. */
function makeAssertUsedCommand(name: string, why: string): Assertion {
  const text = `Used \`${name}\` ${why}`;
  return {
    check: ({ sessions }) => {
      const calls = bashCalls(sessions);
      const used = calls.filter((call) =>
        new RegExp(String.raw`(^|[\n;|&(])\s*${name}\b`).test(call.command),
      );
      return {
        evidence:
          used.length > 0
            ? used.map((call) => `\`${call.command}\``).join(", ")
            : `Never ran it. Commands: ${describeCommands(calls)}`,
        passed: used.length > 0,
        text,
      };
    },
    text,
  };
}

function promoted(sessions: Sessions): (BashCall & { processId: string })[] {
  return bashCalls(sessions).flatMap((call) =>
    call.processId === undefined
      ? []
      : [{ ...call, processId: call.processId }],
  );
}

function replyText(sessions: Sessions): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
}

/**
 * Everything any tool handed back, as one blob. Used to ask whether a number in
 * the reply was read from somewhere rather than invented, without caring which
 * tool it came through.
 */
function toolResultText(sessions: Sessions): string {
  return sessions
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts)
    .flatMap((part) => ("output" in part ? [JSON.stringify(part.output)] : []))
    .join("\n");
}

/**
 * A command outlived its yield window and was handed off rather than killed.
 * The precondition for everything else here: if this fails, the rest of the
 * case is measuring nothing.
 */
const assertPromotedAProcess: Assertion = {
  check: ({ sessions }) => {
    const runs = promoted(sessions);
    return {
      evidence:
        runs.length > 0
          ? runs
              .map((call) => `${call.processId} <- \`${call.command}\``)
              .join(", ")
          : `Nothing was promoted. Commands: ${describeCommands(bashCalls(sessions))}`,
      passed: runs.length > 0,
      text: "A command went to the background",
    };
  },
  text: "A command went to the background",
};

/**
 * The failure the description is written to prevent: a model that does not
 * realize the first copy is still running starts a second one, and then two
 * servers fight over a port.
 */
const assertStartedItOnlyOnce: Assertion = {
  check: ({ sessions }) => {
    const runs = promoted(sessions);
    const counts = new Map<string, number>();
    for (const call of runs) {
      counts.set(call.command, (counts.get(call.command) ?? 0) + 1);
    }
    const repeated = [...counts.entries()].filter(([, count]) => count > 1);
    return {
      evidence:
        repeated.length === 0
          ? `${runs.length} process(es) started, none twice`
          : `Started again while already running: ${repeated
              .map(([command, count]) => `\`${command}\` x${count}`)
              .join(", ")}`,
      passed: repeated.length === 0,
      text: "Did not start a second copy of a running process",
    };
  },
  text: "Did not start a second copy of a running process",
};

/** Every process it started, it also stopped. */
const assertStoppedWhatItStarted: Assertion = {
  check: ({ sessions }) => {
    const calls = bashCalls(sessions);
    const ids = promoted(sessions).flatMap((call) =>
      call.processId ? [call.processId] : [],
    );
    const killCommands = calls
      .map((call) => call.command)
      .filter((command) =>
        new RegExp(String.raw`(^|[\n;|&(])\s*${KILL_COMMAND.name}\b`).test(
          command,
        ),
      );
    const unstopped = ids.filter(
      (id) =>
        !killCommands.some(
          (command) =>
            command.includes(id) ||
            command.includes(`%${id.replace("bg_", "")}`),
        ),
    );
    return {
      evidence:
        ids.length === 0
          ? "Nothing was started, so nothing to stop"
          : unstopped.length === 0
            ? `Stopped all of: ${ids.join(", ")}`
            : `Left running: ${unstopped.join(", ")} (kills: ${killCommands.join(", ") || "none"})`,
      passed: ids.length > 0 && unstopped.length === 0,
      text: "Stopped every process it started",
    };
  },
  text: "Stopped every process it started",
};

/**
 * The mechanism, separate from the model's account of it: `fg` blocked until
 * the process ended and reported the code it really exited with.
 */
const assertFgReportedTheExitCode: Assertion = {
  check: ({ sessions }) => {
    const reporting = bashCalls(sessions).find((call) =>
      /exit code 7\b/.test(call.output),
    );
    return {
      evidence: reporting
        ? `\`${reporting.command}\` returned it`
        : "No command output reported exit code 7",
      passed: reporting !== undefined,
      text: "A follow-up command reported the real exit code",
    };
  },
  text: "A follow-up command reported the real exit code",
};

/** And the model read it, rather than guessing or reporting the handoff. */
const assertReportedExitCodeSeven: Assertion = {
  check: ({ sessions }) => {
    const text = replyText(sessions);
    const passed = /\b7\b/.test(text);
    return {
      evidence: passed
        ? "Reply names exit code 7"
        : `Reply never says 7: ${text.slice(0, 240) || "(no reply text)"}`,
      passed,
      text: "Told the user the exit code was 7",
    };
  },
  text: "Told the user the exit code was 7",
};

/**
 * The number has to have come from the process. A model that never read it can
 * still produce a plausible one, so this asks that the tick it reports actually
 * appeared in some command's output.
 */
const assertReadTheCounter: Assertion = {
  check: ({ sessions }) => {
    const reported = /tick\s*#?(\d+)|\b(\d+)\b/.exec(
      replyText(sessions).replaceAll(/[^\d\sa-z#]/gi, " "),
    );
    const number = reported?.[1] ?? reported?.[2];
    // Any tool result, not just `bash`: reading the process log with
    // `read_file` is a legitimate way to have learned the number.
    const seen =
      number !== undefined &&
      new RegExp(String.raw`tick ${number}\b`).test(toolResultText(sessions));
    return {
      evidence: seen
        ? `Reported tick ${number}, which a command's output contained`
        : `No reported tick number was found in any command output (reply: ${replyText(sessions).slice(0, 160) || "(none)"})`,
      passed: seen,
      text: "Reported a tick count it had actually read",
    };
  },
  text: "Reported a tick count it had actually read",
};

/** Answered from the process's output, not from a guess. */
const assertFoundTheError: Assertion = {
  check: ({ sessions }) => {
    const text = replyText(sessions).toLowerCase();
    const passed = text.includes("disk") || text.includes("e_disk");
    return {
      evidence: passed
        ? "Reply names the disk error"
        : `Reply does not name it: ${replyText(sessions).slice(0, 240) || "(no reply text)"}`,
      passed,
      text: "Reported the error the process logged",
    };
  },
  text: "Reported the error the process logged",
};

/**
 * The wait must not itself become a background process. `fg` blocks for up to
 * ten minutes by default, so inside a `bash` call with an ordinary `yieldMs` the
 * call outlives its own window and gets promoted: the agent asked to look at
 * bg_1 and is handed bg_2, which is now blocked on bg_1 and holding a slot of
 * the per-task cap. Nothing about the id it wanted has been answered.
 */
const assertTheWaitDidNotGetPromoted: Assertion = {
  check: ({ sessions }) => {
    const promotedWaits = promoted(sessions).filter((call) =>
      new RegExp(String.raw`(^|[\n;|&(])\s*${FG_COMMAND.name}\b`).test(
        call.command,
      ),
    );
    return {
      evidence:
        promotedWaits.length === 0
          ? "Every wait finished inside its own call"
          : `The wait was backgrounded instead of answering: ${promotedWaits
              .map((call) => `${call.processId} <- \`${call.command}\``)
              .join(", ")}`,
      passed: promotedWaits.length === 0,
      text: "The wait itself stayed in the foreground",
    };
  },
  text: "The wait itself stayed in the foreground",
};

/**
 * The control. An ordinary command must still behave like an ordinary command:
 * if this fails, backgrounding has leaked into the foreground path.
 */
const assertNothingWentToTheBackground: Assertion = {
  check: ({ sessions }) => {
    const runs = promoted(sessions);
    return {
      evidence:
        runs.length === 0
          ? "Every command finished inline, as expected"
          : `Unexpectedly promoted: ${runs.map((call) => `\`${call.command}\``).join(", ")}`,
      passed: runs.length === 0,
      text: "Left a short command in the foreground",
    };
  },
  text: "Left a short command in the foreground",
};

export const BACKGROUND_PROCESS_EVALS = [
  /**
   * Discovery, with nothing in the prompt naming the mechanism. A server never
   * exits, so the only way to finish this turn is to notice the handoff and
   * work with a process that is still running.
   */
  defineEval({
    assertions: [
      assertPromotedAProcess,
      assertStartedItOnlyOnce,
      assertStoppedWhatItStarted,
    ],
    name: "background-serve-then-clean-up",
    prompt:
      "Write a tiny static site with a single index.html that says Hello Helsinki, serve it on port 8123 with node, and confirm it is really responding by fetching it. Then shut the server down and tell me what it returned.",
  }),

  /**
   * The blocking wait. The turn is split in two on purpose: a model that can
   * read the duration out of the command will simply raise `yieldMs` and hold
   * the call open, which is the right answer to "run this and tell me the exit
   * code" and leaves `fg` unexercised. Being asked for the id first makes the
   * handoff the only route, and the exit code then only exists on the far side
   * of a wait.
   */
  defineEval({
    assertions: [
      assertPromotedAProcess,
      makeAssertUsedCommand(FG_COMMAND.name, "to wait the command out"),
      assertFgReportedTheExitCode,
      assertReportedExitCodeSeven,
    ],
    name: "background-wait-out-a-slow-command",
    prompt:
      "Start this without waiting around for it, and tell me its process id as soon as you have one: node -e \"setTimeout(() => { console.log('finished'); process.exit(7) }, 45000)\". After you have told me the id, wait for it to actually finish and tell me the exit code it ended with.",
  }),

  /**
   * The other half of `fg`: reading a process that never exits. A server has no
   * exit code to wait for, so the only way to answer is to take what it has
   * written since the last read and come back.
   */
  defineEval({
    assertions: [
      assertPromotedAProcess,
      makeAssertUsedCommand(FG_COMMAND.name, "to read a running process"),
      assertTheWaitDidNotGetPromoted,
      assertReadTheCounter,
    ],
    name: "background-read-a-running-process",
    prompt:
      "Start a node script that counts up from 1 and prints 'tick <n>' every second, and leave it running. Once it has been going for a bit, tell me the highest tick number it has printed so far.",
  }),

  /**
   * Enumeration and cleanup across separate calls. Shell state does not survive
   * a `bash` call, so the ids are only recoverable from `jobs` or from earlier
   * tool results -- and a model that lost them cannot finish this.
   */
  defineEval({
    assertions: [
      assertPromotedAProcess,
      makeAssertUsedCommand(JOBS_COMMAND.name, "to enumerate what was running"),
      assertStoppedWhatItStarted,
    ],
    name: "background-enumerate-and-stop-everything",
    prompt:
      "Start two separate node processes that each print a line every second forever, one saying alpha and one saying beta. Then, in a later step, list everything you have left running and stop all of it.",
  }),

  /**
   * Composition. The process prints far more than is worth reading, and the
   * answer is one line in the middle, so filtering at the shell is cheaper than
   * pulling it all into context. Measures the outcome, not the pipeline: a
   * model that reads the log file instead has also used the affordance.
   */
  defineEval({
    assertions: [assertPromotedAProcess, assertFoundTheError],
    name: "background-find-an-error-in-noisy-output",
    prompt:
      "Run a node script that prints 2000 lines of 'worker ok' but prints 'E_DISK_FULL: out of space' as line 900, then keeps printing 'worker ok' every second forever. Once it is running, tell me whether it logged any errors and what they were.",
  }),

  /** The control: an ordinary command must not change behavior. */
  defineEval({
    assertions: [assertNothingWentToTheBackground],
    name: "background-ordinary-command-stays-inline",
    prompt:
      "Make a file work/notes.txt with three lines of lorem ipsum in it, then tell me how many words it has.",
  }),
];
