import ms from "ms";
import { ok } from "neverthrow";
import { z } from "zod";

import { agentBrowserScreenshotsNote } from "../lib/agent-browser-screenshots-note";
import { createBashDescription, createBashEnv } from "../lib/create-bash-env";
import { PNPM_COMMAND } from "../lib/shell-commands/pnpm";
import { Store } from "../lib/store";
import { systemNote } from "../lib/system-note";
import { extractContextItemsFromOutput } from "../lib/tool-output-context-items";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

const MAX_OUTPUT_LENGTH = 30_000;
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
  }),
}).create({
  description: createBashDescription(),
  async execute({ appConfig, input, messageId, partId, sessionId, signal }) {
    const bash = createBashEnv({
      appConfig,
      sessionId,
      upsertContextItem: async (item) => {
        // Best-effort side-channel write; if the part has been finalized or
        // removed we silently skip, since the screenshot is still on disk.
        await Store.upsertToolPartContextItem(
          { messageId, partId, sessionId },
          item,
          appConfig,
          { signal },
        );
      },
    });
    const startedAt = performance.now();
    const result = await bash.exec(input.command, { signal });
    const durationMs = Math.round(performance.now() - startedAt);
    const commands = Array.isArray(result.metadata?.commands)
      ? result.metadata.commands
      : [];

    return ok({
      command: input.command,
      commands,
      durationMs,
      exitCode: result.exitCode,
      output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
    });
  },
  readOnly: false,
  timeoutMs: ({ input }) => input.timeoutMs,
  toModelOutput: ({ output }) => {
    const hasErrors = output.exitCode !== 0;

    const totalBytes = Buffer.byteLength(output.output, "utf8");
    const totalLines = output.output ? output.output.split("\n").length : 0;

    let displayOutput = output.output;
    let truncationNotice = "";
    if (displayOutput.length > MAX_OUTPUT_LENGTH) {
      const keptBytes = Buffer.byteLength(
        displayOutput.slice(displayOutput.length - MAX_OUTPUT_LENGTH),
        "utf8",
      );
      truncationNotice =
        `[Output truncated: showing last ${formatBytes(keptBytes)} of ${formatBytes(totalBytes)} (${totalLines} lines total). ` +
        `Re-run with \`tail\`, \`head\`, or \`grep\` to view other parts.]\n`;
      displayOutput = displayOutput.slice(
        displayOutput.length - MAX_OUTPUT_LENGTH,
      );
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

    if (
      output.commands.includes("pnpm") &&
      displayOutput.includes("Ignored build scripts:") &&
      displayOutput.includes("Warning")
    ) {
      outputParts.push(
        systemNote`
          This warning means some packages were not built during installation.
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

    if (
      hasErrors &&
      (displayOutput.includes("Cannot find module") ||
        displayOutput.includes("Cannot find package") ||
        displayOutput.includes("ERR_MODULE_NOT_FOUND"))
    ) {
      outputParts.push(
        systemNote`
          This error indicates a required module is missing. You may need to install dependencies by running:
          \`${PNPM_COMMAND.name} install\`
        `,
      );
    }

    const screenshotsNote = agentBrowserScreenshotsNote(
      extractContextItemsFromOutput(output),
    );
    if (screenshotsNote) {
      outputParts.push(screenshotsNote);
    }

    return {
      type: hasErrors ? "error-text" : "text",
      value: [exitLine, "", ...outputParts, "", durationLine].join("\n"),
    };
  },
});
