import ms from "ms";
import { ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { z } from "zod";

import { CHAT_FOLDER_NAMES } from "../constants";
import { absolutePathJoin } from "../lib/absolute-path-join";
import {
  AppGuideHandOffSchema,
  appGuidesShown,
  type RecordedAppGuide,
  withAppGuideHandOffs,
} from "../lib/apps/guide-hand-off";
import { ampersandUse } from "../lib/background-ampersand";
import {
  type BackgroundProcessInfo,
  type BackgroundRunHandle,
  promoteBackgroundProcess,
  rememberForegroundPrograms,
  startBackgroundRun,
} from "../lib/background-processes";
import { createBashDescription, createBashEnv } from "../lib/create-bash-env";
import {
  BrowserSkillSchema,
  browserSkillToDeliver,
  type BrowserSkill,
} from "../lib/browser-skill-delivery";
import { executeError } from "../lib/execute-error";
import { ignoredBuildsNote } from "../lib/ignored-builds-note";
import { lastLoadedSkillDir } from "../lib/loaded-skill";
import { sessionRole } from "../lib/chat/children";
import { folderReach } from "../lib/chat/folder-reach";
import {
  FG_COMMAND,
  JOBS_COMMAND,
  KILL_COMMAND,
} from "../lib/shell-commands/background-jobs";
import {
  browserScreenshot,
  BrowserScreenshotSchema,
} from "../lib/browser-screenshot";
import { describeImageSize } from "../lib/image-preview";
import { AGENT_BROWSER_COMMAND } from "../lib/shell-commands/agent-browser";
import {
  BrowserFollowUp,
  PageAfterSchema,
  pageAfterText,
  withBrowserFollowUp,
} from "../lib/shell-commands/agent-browser-follow-up";
import {
  CommandRunSchema,
  CommandRuns,
  withCommandRuns,
} from "../lib/shell-commands/command-runs";
import {
  type HandOff,
  HandOffSchema,
  withHandOffs,
} from "../lib/shell-commands/task-hand-off";
import { systemNote } from "../lib/system-note";
import {
  TRUNCATE_HEAD_BYTES,
  TRUNCATE_TAIL_BYTES,
  truncateMiddle,
} from "../lib/truncate-buffer";
import { RelativePathSchema } from "../schemas/paths";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";
import { skillInstructions } from "./load-skill";
import { workDir } from "../lib/work-dir";
import {
  interruptedByUser,
  interruptibleWait,
  type WaitInterrupt,
} from "../lib/wait-interrupts";

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
 * How long a command a message interrupted still gets to finish on its own
 * before it moves to the background. Long enough for an `fg` the same message
 * ended to answer for itself, rather than being promoted as a second process.
 */
const MESSAGE_GRACE_MS = 1000;

/**
 * Resolves with the run's outcome, with `"still-running"` once `yieldMs` has
 * passed, or with `"interrupted"` when `interrupt` fires first. The run is
 * never cancelled here: a command that outlives its yield window is promoted
 * rather than killed, because the work it has already done is worth more than
 * a tidy tool result.
 */
function raceYield<T>(
  promise: Promise<T>,
  yieldMs: number,
): Promise<"still-running" | T>;
function raceYield<T>(
  promise: Promise<T>,
  yieldMs: number,
  interrupt: AbortSignal,
): Promise<"interrupted" | "still-running" | T>;
async function raceYield<T>(
  promise: Promise<T>,
  yieldMs: number,
  interrupt?: AbortSignal,
): Promise<"interrupted" | "still-running" | T> {
  let timer: NodeJS.Timeout | undefined;
  let onInterrupt: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"still-running">((resolve) => {
        timer = setTimeout(() => {
          resolve("still-running");
        }, yieldMs);
      }),
      new Promise<"interrupted">((resolve) => {
        onInterrupt = () => {
          resolve("interrupted");
        };
        interrupt?.addEventListener("abort", onInterrupt, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onInterrupt) {
      interrupt?.removeEventListener("abort", onInterrupt);
    }
  }
}

/** The longest a trailing `&` waits for its command to start a program. */
const AMPERSAND_START_MS = 1000;
/**
 * How long a started program gets to fail on the spot (a missing script, a
 * port in use) before the call returns, so that failure is answered here.
 */
const AMPERSAND_SETTLE_MS = 300;

/** What a call using `&` other than at its very end is told. Nothing ran. */
const AMPERSAND_REFUSAL = `Nothing ran: \`&\` sends a command to the background only at the very end of a call, as in \`pnpm dev &\` or \`cd app && pnpm dev &\`. Start each background command in a call of its own ending in \`&\`, then run the rest; \`${JOBS_COMMAND.name} -l\` lists them and \`wait\` waits for them.`;

/**
 * Resolves with the run's outcome if it ends soon after starting, and with
 * `"still-running"` once its first program has had a moment, or the shell
 * has run that long without starting one.
 */
async function startedOrDone(handle: BackgroundRunHandle) {
  const done = new AbortController();
  const after = (delay: number) =>
    setTimeoutPromise(delay, "still-running" as const, {
      signal: done.signal,
    }).catch(() => "still-running" as const);
  try {
    return await Promise.race([
      handle.completion,
      handle.started.then(() => after(AMPERSAND_SETTLE_MS)),
      after(AMPERSAND_START_MS),
    ]);
  } finally {
    done.abort();
  }
}

const bashOutputSchema = z.object({
  /**
   * The apps whose guides the call's `app` commands handed the model whole,
   * each with a digest of the guide as it was (`guide-hand-off.ts`).
   */
  appGuides: z.array(AppGuideHandOffSchema).optional(),
  /** Set when a trailing `&` sent the command to the background. */
  backgrounded: z.boolean().optional(),
  /**
   * The `agent-browser` skill's instructions, set on the first result in the
   * model's view of the session that ran the command.
   */
  browserSkill: BrowserSkillSchema.optional(),
  command: z.string(),
  commands: z.array(z.string()),
  durationMs: z.number().default(0),
  /** Absent when the command was still running when the call returned. */
  exitCode: z.number().optional(),
  /** The tasks the call's `task` commands handed work to, when any did. */
  handOffs: z.array(HandOffSchema).optional(),
  /**
   * What answered each command the shell ran, and under which sandbox; for
   * the session log, never the model. A promoted command's is what it had
   * run when the call returned.
   */
  ran: z.array(CommandRunSchema).optional(),
  /**
   * The page after the call's agent-browser commands changed it, when
   * nothing in the call read it afterwards.
   */
  pageAfter: PageAfterSchema.optional(),
  /**
   * The last screenshot the call's agent-browser commands took, shown to a
   * model that takes images as part of the result.
   */
  screenshot: BrowserScreenshotSchema.optional(),
  /** Set when the command was promoted; holds its bounded process log. */
  logFilePath: RelativePathSchema.optional(),
  logOmittedBytes: z.number().optional(),
  logWriteError: z.string().optional(),
  /**
   * Set when a message arriving mid-call, rather than `yieldMs`, moved the
   * command to the background: who wrote it.
   */
  movedForMessageFrom: z.enum(["other", "user"]).optional(),
  /** Output dropped because a promoted command outpaced the pending buffer. */
  omittedBytes: z.number().default(0),
  output: z.string(),
  /** The real pids of what a promoted command was running when it moved. */
  pids: z.array(z.number()).optional(),
  /** Set when the command outlived `yieldMs` and is still running. */
  processId: z.string().optional(),
  spillFilePath: RelativePathSchema.optional(),
});

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
  outputSchema: bashOutputSchema,
}).create({
  // Built per call: the command list it renders describes capabilities that a
  // feature flag can turn on and off while the app is running.
  description: () => createBashDescription(),
  async execute({ input, model, partId, sessionId, signal, chatId }) {
    const ampersand = ampersandUse(input.command);
    if (ampersand === "refused") {
      return ok({
        command: input.command,
        commands: [],
        durationMs: 0,
        exitCode: 2,
        omittedBytes: 0,
        output: AMPERSAND_REFUSAL,
      });
    }
    const folders = await folderReach(chatId);
    const yieldMs = clampYieldMs(input.yieldMs);
    const startedAt = performance.now();
    // The chat's own commands are its conversation's: a task of the chat's
    // runs in the same folder with a task's shell.
    const role = sessionRole(chatId, sessionId) ?? "task";
    const bash = await createBashEnv({
      folders,
      callPartId: partId,
      loadedSkillDir: await lastLoadedSkillDir({ chatId, sessionId }),
      role,
      // `fg` waits inside this call, so what is left of the window is its
      // ceiling. Measured from here rather than from the race below, which only
      // makes it return sooner than it strictly has to.
      remainingYieldMs: () => yieldMs - (performance.now() - startedAt),
      sessionId,
      chatId,
      model: model.canonicalId,
    });
    // Interpreter metadata, only available once the run finishes. A promoted
    // command reports none, which is what the empty default stands for.
    let commands: string[] = [];
    const browserFollowUp = new BrowserFollowUp();
    const handOffs: HandOff[] = [];
    const appGuides: RecordedAppGuide[] = [];
    const commandRuns = new CommandRuns();
    const ran = () => {
      const rows = commandRuns.rows();
      return rows.length > 0 ? { ran: rows } : {};
    };

    const handle = startBackgroundRun({
      callerSignal: signal,
      command: input.command,
      explanation: input.explanation,
      run: async ({ signal: runSignal }) => {
        try {
          const result = await withCommandRuns(commandRuns, () =>
            withHandOffs(handOffs, () =>
              withAppGuideHandOffs(appGuides, () =>
                withBrowserFollowUp(browserFollowUp, () =>
                  bash.exec(input.command, { signal: runSignal }),
                ),
              ),
            ),
          );
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
    });

    const promotedResult = (
      info: BackgroundProcessInfo,
      movedForMessageFrom?: WaitInterrupt["from"],
    ) => {
      const { omittedBytes, text } = handle.buffer.drain();
      return ok({
        ...(ampersand === "trailing" ? { backgrounded: true } : {}),
        command: input.command,
        commands: [],
        durationMs: Math.round(performance.now() - startedAt),
        logFilePath: info.logFilePath,
        logOmittedBytes: info.logOmittedBytes,
        ...(info.logWriteError ? { logWriteError: info.logWriteError } : {}),
        ...(movedForMessageFrom ? { movedForMessageFrom } : {}),
        omittedBytes,
        output: text,
        pids: info.pids,
        processId: info.id,
        ...ran(),
      });
    };

    // A trailing `&` asks for the background now: the call returns once the
    // command has started its program, or failed before it could.
    if (ampersand === "trailing") {
      const early = await startedOrDone(handle);
      if (early === "still-running") {
        const promoted = promoteBackgroundProcess({
          handle,
          sessionId,
          chatId,
        });
        if ("error" in promoted) {
          handle.abort();
          return executeError(promoted.error);
        }
        return promotedResult(promoted.info);
      }
    }

    // A message for the session is heard at the agent's next step, which a
    // foreground command would hold back for the rest of its window. It never
    // ends the command: the command moves to the background and keeps
    // running, and the call returns so the message is heard now.
    const interrupt = interruptibleWait(sessionId);
    let outcome;
    try {
      outcome = await raceYield(handle.completion, yieldMs, interrupt.signal);
    } finally {
      interrupt.release();
    }
    if (outcome === "interrupted") {
      outcome = await raceYield(handle.completion, MESSAGE_GRACE_MS);
      if (outcome === "still-running") {
        const promoted = promoteBackgroundProcess({
          handle,
          sessionId,
          chatId,
        });
        if ("info" in promoted) {
          return promotedResult(
            promoted.info,
            interruptedByUser(interrupt.signal) ? "user" : "other",
          );
        }
        // One that cannot move to the background (the cap, a closing
        // session) stays in the foreground for the rest of its window, as if
        // no message had come.
        outcome = await raceYield(
          handle.completion,
          Math.max(0, yieldMs - (performance.now() - startedAt)),
        );
      }
    }
    const durationMs = Math.round(performance.now() - startedAt);
    if (outcome !== "still-running") {
      // What its programs left running in their groups is still the agent's.
      rememberForegroundPrograms(sessionId, handle);
    }

    if (outcome === "still-running") {
      const promoted = promoteBackgroundProcess({ handle, sessionId, chatId });
      if ("error" in promoted) {
        handle.abort();
        return executeError(promoted.error);
      }
      return promotedResult(promoted.info);
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
        path.posix.join(CHAT_FOLDER_NAMES.toolOutput, `${partId}.log`),
      );
      const absPath = absolutePathJoin(workDir(chatId), spillFilePath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, outcome.output, {
        encoding: "utf8",
        signal,
      });
    }

    const pageAfter = await browserFollowUp.take(signal);
    const screenshotPath = browserFollowUp.takeScreenshot();
    const screenshot =
      screenshotPath !== undefined && model.features.includes("inputImage")
        ? await browserScreenshot(screenshotPath, signal)
        : undefined;
    const browserSkill = commands.includes(AGENT_BROWSER_COMMAND.name)
      ? await browserSkillToDeliver({
          sessionId,
          chatId,
          model: model.canonicalId,
        })
      : undefined;
    const guidesShown = appGuidesShown(appGuides, outcome.output);

    return ok({
      ...(guidesShown.length > 0 ? { appGuides: guidesShown } : {}),
      ...(browserSkill ? { browserSkill } : {}),
      command: input.command,
      commands,
      durationMs,
      exitCode: outcome.exitCode,
      ...(handOffs.length > 0 ? { handOffs } : {}),
      omittedBytes: 0,
      output: outcome.output,
      ...(pageAfter ? { pageAfter } : {}),
      ...ran(),
      ...(screenshot ? { screenshot } : {}),
      spillFilePath,
    });
  },
  readOnly: false,
  timeoutMs: ({ input }) => bashToolCallTimeoutMs(input.yieldMs),
  toModelOutput: ({ output }) => {
    const text = bashOutputText(output);
    if (!output.screenshot || text.type === "error-text") {
      return text;
    }
    return {
      type: "content",
      value: [
        {
          text: `${text.value}\n\nThe screenshot the call took, as \`read_file\` would show it${describeImageSize(output.screenshot)}:`,
          type: "text",
        },
        {
          data: { data: output.screenshot.base64Data, type: "data" },
          mediaType: output.screenshot.mimeType,
          type: "file",
        },
      ],
    };
  },
});

/** The call's result as text: its output, and what the browser attached. */
function bashOutputText(output: z.output<typeof bashOutputSchema>): {
  type: "error-text" | "text";
  value: string;
} {
  {
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
      const after = ms(output.durationMs, { long: true });
      // A shell's own announcement of a job: its number, then its pids.
      const why = output.backgrounded
        ? `[${output.processId.replace("bg_", "")}] ${[output.processId, ...(output.pids ?? [])].join(" ")}`
        : output.movedForMessageFrom === "user"
          ? `The user sent you a message while this was running, so it moved to the background after ${after} for you to read the message. It was not stopped and is still running.`
          : output.movedForMessageFrom === "other"
            ? `A message arrived for you while this was running, so it moved to the background after ${after} for you to read the message. It was not stopped and is still running.`
            : `Still running after ${after}, so it moved to the background.`;
      return {
        type: "text",
        value: [
          why,
          ...(output.backgrounded
            ? []
            : [
                `Process id: ${output.processId}${output.pids?.length ? ` (pid ${output.pids.join(", ")})` : ""}`,
              ]),
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
    const pageAfterSection = output.pageAfter
      ? ["", pageAfterText(output.pageAfter)]
      : [];
    const browserSkillSection = output.browserSkill
      ? ["", browserSkillText(output.browserSkill)]
      : [];

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
          ...pageAfterSection,
          ...browserSkillSection,
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
      value: [
        exitLine,
        "",
        ...outputParts,
        "",
        durationLine,
        ...pageAfterSection,
        ...browserSkillSection,
      ].join("\n"),
    };
  }
}

/**
 * The skill's instructions after the command that brought them, led by a note
 * saying why they are here, so the model reads them as the skill it would
 * otherwise have loaded rather than as something the command printed.
 */
function browserSkillText(skill: BrowserSkill) {
  const truncation = skill.contentTruncated
    ? ` Only the beginning of the guide fits here. Run \`${AGENT_BROWSER_COMMAND.name} skills get core\` for the rest before relying on it.`
    : "";
  const references = `\`${AGENT_BROWSER_COMMAND.name} skills get core --full\` prints the references it links to.`;
  return [
    systemNote`
      This is your first \`${AGENT_BROWSER_COMMAND.name}\` command in this session, so its guide comes with the output below. Follow it for the rest of your browser work; there is no need to load it. ${references}${truncation}
    `.trim(),
    "",
    skillInstructions({
      content: skill.content,
      name: skill.name,
    }),
  ].join("\n");
}
