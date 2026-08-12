import ms from "ms";
import { ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { TASK_FOLDER_NAMES } from "../constants";
import { absolutePathJoin } from "../lib/absolute-path-join";
import {
  promoteBackgroundProcess,
  startBackgroundRun,
} from "../lib/background-processes";
import { createBashDescription, createBashEnv } from "../lib/create-bash-env";
import { executeError } from "../lib/execute-error";
import { ignoredBuildsNote } from "../lib/ignored-builds-note";
import {
  FG_COMMAND,
  JOBS_COMMAND,
  KILL_COMMAND,
} from "../lib/shell-commands/background-jobs";
import { systemNote } from "../lib/system-note";
import { taskDir } from "../lib/task-dir-utils";
import { resolveTaskProjectFolder } from "../lib/task-project-folder";
import { getTaskState } from "../lib/task-record";
import {
  TRUNCATE_HEAD_BYTES,
  TRUNCATE_TAIL_BYTES,
  truncateMiddle,
} from "../lib/truncate-buffer";
import { RelativePathSchema } from "../schemas/paths";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

const DEFAULT_YIELD_MS = ms("30 seconds");
const MIN_YIELD_MS = 250;
/**
 * Beyond this, holding a tool call open is worse than polling. Chosen to still
 * cover a cold dependency install inline, the longest thing a foreground call
 * routinely does.
 */
const MAX_YIELD_MS = ms("10 minutes");
/**
 * The tool-call machine cancels a call that outlives its own timeout, which
 * would abort the run before this tool can promote it. That timeout is derived
 * from `yieldMs` plus this slack so promotion always wins the race.
 */
const YIELD_TIMEOUT_SLACK_MS = ms("30 seconds");

function bashToolCallTimeoutMs(yieldMs: number) {
  return clampYieldMs(yieldMs) + YIELD_TIMEOUT_SLACK_MS;
}

function clampYieldMs(yieldMs: number) {
  return Math.min(MAX_YIELD_MS, Math.max(MIN_YIELD_MS, yieldMs));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Resolves with the run's outcome, or with `"still-running"` once `yieldMs` has
 * passed. The run is never cancelled here: a command that outlives its yield
 * window is promoted rather than killed, because the work it has already done is
 * worth more than a tidy tool result.
 */
async function raceYield<T>(
  promise: Promise<T>,
  yieldMs: number,
): Promise<"still-running" | T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"still-running">((resolve) => {
        timer = setTimeout(() => {
          resolve("still-running");
        }, yieldMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const BashTool = setupTool({
  inputSchema: BaseInputSchema.extend({
    command: z.string().meta({ description: "The bash command to run" }),
    yieldMs: z
      .number()
      .optional()
      .default(DEFAULT_YIELD_MS)
      .meta({
        description: [
          "How long to wait for the command before yielding.",
          "A command that finishes sooner returns its output as usual; one that",
          "does not is NOT killed -- it keeps running and you get a process id",
          `to follow with the \`${FG_COMMAND.name}\` command.`,
          `Default ${DEFAULT_YIELD_MS}; range ${MIN_YIELD_MS}-${MAX_YIELD_MS}.`,
          "Pass a small value (e.g. 1000) when you are deliberately starting a",
          "long-lived process such as a server and want its id promptly.",
        ].join(" "),
      }),
  }),
  name: "bash",
  outputSchema: z.object({
    command: z.string(),
    commands: z.array(z.string()),
    durationMs: z.number().default(0),
    /** Absent when the command was still running when the call returned. */
    exitCode: z.number().optional(),
    /** Set when the command was promoted; holds its bounded process log. */
    logFilePath: RelativePathSchema.optional(),
    logOmittedBytes: z.number().optional(),
    logWriteError: z.string().optional(),
    /** Output dropped because a promoted command outpaced the pending buffer. */
    omittedBytes: z.number().default(0),
    output: z.string(),
    /** Set when the command outlived `yieldMs` and is still running. */
    processId: z.string().optional(),
    spillFilePath: RelativePathSchema.optional(),
  }),
}).create({
  // Built per call: the command list it renders describes capabilities that a
  // feature flag can turn on and off while the app is running.
  description: () => createBashDescription(),
  async execute({ input, partId, sessionId, signal, taskId }) {
    const taskState = await getTaskState(taskDir(taskId));
    const bash = await createBashEnv({
      attachedFolders: taskState.attachedFolders,
      projectFolderName: await resolveTaskProjectFolder(taskId),
      sessionId,
      taskId,
    });
    const yieldMs = clampYieldMs(input.yieldMs);
    const startedAt = performance.now();
    // Interpreter metadata, only available once the run finishes. A promoted
    // command reports none, which is what the empty default stands for.
    let commands: string[] = [];

    const handle = startBackgroundRun({
      callerSignal: signal,
      command: input.command,
      run: async ({ signal: runSignal }) => {
        try {
          const result = await bash.exec(input.command, { signal: runSignal });
          commands = Array.isArray(result.metadata?.commands)
            ? result.metadata.commands.filter(
                (command): command is string => typeof command === "string",
              )
            : [];
          return {
            exitCode: result.exitCode,
            output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
          };
        } catch (error) {
          if (runSignal.aborted) {
            throw error;
          }
          // just-bash surfaces some filesystem failures (e.g. a redirect into a
          // read-only mount) as thrown errors instead of exit codes. Report them
          // like a failed command so the agent adjusts its command instead of
          // treating the tool itself as broken.
          return {
            exitCode: 1,
            output: error instanceof Error ? error.message : String(error),
          };
        }
      },
      taskId,
    });

    const outcome = await raceYield(handle.completion, yieldMs);
    const durationMs = Math.round(performance.now() - startedAt);

    if (outcome === "still-running") {
      const promoted = promoteBackgroundProcess({ handle, sessionId, taskId });
      if ("error" in promoted) {
        handle.abort();
        return executeError(promoted.error);
      }
      const { omittedBytes, text } = handle.buffer.drain();
      return ok({
        command: input.command,
        commands: [],
        durationMs,
        logFilePath: promoted.info.logFilePath,
        logOmittedBytes: promoted.info.logOmittedBytes,
        ...(promoted.info.logWriteError
          ? { logWriteError: promoted.info.logWriteError }
          : {}),
        omittedBytes,
        output: text,
        processId: promoted.info.id,
      });
    }

    if ("errorMessage" in outcome) {
      return executeError(
        outcome.errorMessage || "The command was stopped before it finished.",
      );
    }

    const { truncated } = truncateMiddle(outcome.output);

    let spillFilePath: undefined | z.output<typeof RelativePathSchema>;
    if (truncated) {
      spillFilePath = RelativePathSchema.parse(
        path.posix.join(
          TASK_FOLDER_NAMES.work,
          TASK_FOLDER_NAMES.toolOutput,
          `${partId}.log`,
        ),
      );
      const absPath = absolutePathJoin(taskDir(taskId), spillFilePath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, outcome.output, {
        encoding: "utf8",
        signal,
      });
    }

    return ok({
      command: input.command,
      commands,
      durationMs,
      exitCode: outcome.exitCode,
      omittedBytes: 0,
      output: outcome.output,
      spillFilePath,
    });
  },
  readOnly: false,
  timeoutMs: ({ input }) => bashToolCallTimeoutMs(input.yieldMs),
  toModelOutput: ({ output }) => {
    const { content, omittedLines, totalBytes, totalLines, truncated } =
      truncateMiddle(output.output);

    const displayOutput = truncated ? content : output.output;

    let truncationNotice = "";
    if (truncated) {
      const headKB = formatBytes(TRUNCATE_HEAD_BYTES);
      const tailKB = formatBytes(TRUNCATE_TAIL_BYTES);
      const stats =
        `showing first ${headKB} and last ${tailKB} of ${formatBytes(totalBytes)}` +
        ` (${totalLines} lines total, ${omittedLines} omitted)`;
      // Not "full": a native binary's output reaches this bounded by the shim's
      // stream collector, which keeps a head and a tail and marks the gap. The
      // file is longer than what is shown and says where it was cut.
      const spillLine = output.spillFilePath
        ? `\nOutput saved to: ${output.spillFilePath}`
        : "";
      truncationNotice = `[Output truncated: ${stats}.${spillLine}]\n`;
    }

    const durationLine = `Duration: ${ms(output.durationMs, { long: true })}`;

    if (output.processId) {
      const promotedSkippedBuilds = ignoredBuildsNote(displayOutput);
      const dropNotice =
        output.omittedBytes > 0
          ? `[${formatBytes(output.omittedBytes)} of earlier output was dropped: the command wrote faster than this call could hold, and this happened before the log file existed, so it is gone. Use a smaller yieldMs to start reading sooner.]\n`
          : "";
      const logNotice = output.logWriteError
        ? `[The process log could not be written: ${output.logWriteError}]\n`
        : (output.logOmittedBytes ?? 0) > 0
          ? `[The bounded process log omitted ${formatBytes(output.logOmittedBytes ?? 0)}.]\n`
          : "";
      return {
        type: "text",
        value: [
          `Still running after ${ms(output.durationMs, { long: true })}, so it moved to the background.`,
          `Process id: ${output.processId}`,
          "",
          displayOutput
            ? `Live subprocess output so far:\n\n${(dropNotice + logNotice + truncationNotice + displayOutput).replace(/\n+$/, "")}`
            : "No output yet.",
          // Spread rather than defaulted to "", which would join into a stray
          // blank line. Keyed on the text alone: the interpreter only reports
          // which commands ran once it finishes, and this call returns before
          // that.
          ...(promotedSkippedBuilds ? [promotedSkippedBuilds] : []),
          systemNote`
            ${output.processId} is still running. Follow it with \`${FG_COMMAND.name} ${output.processId}\`, which prints what it has written since your last read and exits with its exit code once it finishes, and stop it with \`${KILL_COMMAND.name} ${output.processId}\`. \`${JOBS_COMMAND.name}\` lists everything still running. Its bounded process log is at ${output.logFilePath}.
            Do not start a second copy of a process that is already running. A process you leave running stays running after your turn ends, so kill anything the user does not need -- but leave a server running if they still want to reach it.
          `,
        ].join("\n"),
      };
    }

    const hasErrors = output.exitCode !== 0;
    const exitLine = `Exit code: ${output.exitCode ?? "unknown"}`;

    // Say that the command printed nothing rather than leaving a gap where the
    // output would be. Silence otherwise reads as a swallowed result, and the
    // usual next move is to run something else to find out which it was.
    if (!hasErrors && !displayOutput) {
      return {
        type: "text",
        value: [
          exitLine,
          "",
          "The command produced no output on stdout or stderr.",
          "",
          durationLine,
        ].join("\n"),
      };
    }

    const outputParts: string[] = [
      "Command output:",
      "",
      (truncationNotice + displayOutput).replace(/\n+$/, ""),
    ];

    const skippedBuilds = output.commands.includes("pnpm")
      ? ignoredBuildsNote(displayOutput)
      : undefined;
    if (skippedBuilds) {
      outputParts.push(skippedBuilds);
    }

    return {
      type: hasErrors ? "error-text" : "text",
      value: [exitLine, "", ...outputParts, "", durationLine].join("\n"),
    };
  },
});
