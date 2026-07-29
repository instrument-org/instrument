import ms from "ms";
import { ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { TASK_FOLDER_NAMES } from "../constants";
import { absolutePathJoin } from "../lib/absolute-path-join";
import { createBashDescription, createBashEnv } from "../lib/create-bash-env";
import { PNPM_COMMAND } from "../lib/shell-commands/pnpm";
import { systemNote } from "../lib/system-note";
import { taskDir } from "../lib/task-dir-utils";
import { getTaskState } from "../lib/task-state-store";
import {
  TRUNCATE_HEAD_BYTES,
  TRUNCATE_TAIL_BYTES,
  truncateMiddle,
} from "../lib/truncate-buffer";
import { RelativePathSchema } from "../schemas/paths";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

const DEFAULT_TIMEOUT_MS = ms("30 seconds");

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const BashTool = setupTool({
  inputSchema: BaseInputSchema.extend({
    command: z.string().meta({ description: "The bash command to run" }),
    timeoutMs: z
      .number()
      .optional()
      .default(DEFAULT_TIMEOUT_MS)
      .meta({
        description: [
          "Timeout in ms; on expiry the command is killed and you must re-run with a higher value.",
          `Default ${DEFAULT_TIMEOUT_MS}.`,
        ].join(" "),
      }),
  }),
  name: "bash",
  outputSchema: z.object({
    command: z.string(),
    commands: z.array(z.string()),
    durationMs: z.number().default(0),
    exitCode: z.number(),
    output: z.string(),
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
      sessionId,
      taskId,
    });
    const startedAt = performance.now();
    let result;
    try {
      result = await bash.exec(input.command, { signal });
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      // just-bash surfaces some filesystem failures (e.g. a redirect into a
      // read-only mount) as thrown errors instead of exit codes. Report them
      // like a failed command so the agent adjusts its command instead of
      // treating the tool itself as broken.
      return ok({
        command: input.command,
        commands: [],
        durationMs: Math.round(performance.now() - startedAt),
        exitCode: 1,
        output: error instanceof Error ? error.message : String(error),
      });
    }
    const durationMs = Math.round(performance.now() - startedAt);
    const commands = Array.isArray(result.metadata?.commands)
      ? result.metadata.commands
      : [];

    const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");

    const { truncated } = truncateMiddle(combined);

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
      await fs.writeFile(absPath, combined, { encoding: "utf8", signal });
    }

    return ok({
      command: input.command,
      commands,
      durationMs,
      exitCode: result.exitCode,
      output: combined,
      spillFilePath,
    });
  },
  readOnly: false,
  timeoutMs: ({ input }) => input.timeoutMs,
  toModelOutput: ({ output }) => {
    const hasErrors = output.exitCode !== 0;

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
      const spillLine = output.spillFilePath
        ? `\nFull output saved to: ${output.spillFilePath}`
        : "";
      truncationNotice = `[Output truncated: ${stats}.${spillLine}]\n`;
    }

    const exitLine = `Exit code: ${output.exitCode}`;
    const durationLine = `Duration: ${ms(output.durationMs, { long: true })}`;

    if (!hasErrors && !displayOutput) {
      return {
        type: "text",
        value: [exitLine, "", durationLine].join("\n"),
      };
    }

    const outputParts: string[] = [
      "Command output:",
      "",
      (truncationNotice + displayOutput).replace(/\n+$/, ""),
    ];

    // Matches both spellings pnpm uses: a warning box when strictDepBuilds is
    // off, and ERR_PNPM_IGNORED_BUILDS when it is on. Only the shared
    // "Ignored build scripts:" prefix is common to the two.
    if (
      output.commands.includes("pnpm") &&
      displayOutput.includes("Ignored build scripts:")
    ) {
      outputParts.push(
        systemNote`
          Some packages were not built during installation.
          If you encounter "Cannot find module" errors or the package doesn't work:

          1. Read pnpm-workspace.yaml from the workspace root.
          2. Add the package names from the warning to the \`allowBuilds\` mapping.
          \`\`\`yaml
          allowBuilds:
            esbuild: true
            sharp: true
          \`\`\`
          3. Run \`${PNPM_COMMAND.name} rebuild <package-name>\` for each package you added.

          All three steps are required. Running rebuild without first modifying pnpm-workspace.yaml will not fix the issue.
        `,
      );
    }

    return {
      type: hasErrors ? "error-text" : "text",
      value: [exitLine, "", ...outputParts, "", durationLine].join("\n"),
    };
  },
});
