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

export const BashTool = setupTool({
  inputSchema: BaseInputSchema.extend({
    command: z.string().meta({ description: "The bash command to run" }),
    timeoutMs: z.number().optional().default(ms("30 seconds")).meta({
      description: "The timeout in milliseconds for the command",
    }),
  }),
  name: "bash",
  outputSchema: z.object({
    command: z.string(),
    commands: z.array(z.string()),
    exitCode: z.number(),
    output: z.string(),
  }),
}).create({
  description: createBashDescription(),
  async execute({ appConfig, input, messageId, partId, sessionId, signal }) {
    const bash = createBashEnv({
      appConfig,
      partId,
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
    const result = await bash.exec(input.command, { signal });
    const commands = Array.isArray(result.metadata?.commands)
      ? result.metadata.commands
      : [];

    return ok({
      command: input.command,
      commands,
      exitCode: result.exitCode,
      output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
    });
  },
  readOnly: false,
  timeoutMs: ({ input }) => input.timeoutMs,
  toModelOutput: ({ output }) => {
    const hasErrors = output.exitCode !== 0;

    let displayOutput = output.output;
    if (displayOutput.length > MAX_OUTPUT_LENGTH) {
      const truncated = displayOutput.length - MAX_OUTPUT_LENGTH;
      displayOutput =
        `... (truncated ${truncated} characters)\n` +
        displayOutput.slice(displayOutput.length - MAX_OUTPUT_LENGTH);
    }

    if (!hasErrors && !displayOutput) {
      return { type: "text", value: `$ ${output.command}` };
    }

    const outputParts: string[] = [];
    if (displayOutput) {
      outputParts.push(displayOutput);
    }

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

    const finalOutput = outputParts.join("\n");

    return {
      type: hasErrors ? "error-text" : "text",
      value: [`$ ${output.command}`, finalOutput].join("\n"),
    };
  },
});
