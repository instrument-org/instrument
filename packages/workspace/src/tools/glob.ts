import ms from "ms";
import { ok } from "neverthrow";
import { z } from "zod";

import { globSortedByMtime, resolveGlobPattern } from "../lib/glob";
import { resolveAgentPath } from "../lib/resolve-agent-path";
import { buildTaskFsLayout } from "../lib/task-fs-layout";
import { resolveVirtualPath } from "../lib/workspace-fs-layout";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

const GLOB_LIMIT = 100;

export const Glob = setupTool({
  inputSchema: BaseInputSchema.extend({
    path: z.string().optional().meta({
      description:
        "Relative path to a folder to search within, or a read-only attached-folder mount path (/mnt/<name>). Defaults to the task root if not specified.",
    }),
    pattern: z
      .string()
      .meta({ description: "Glob pattern to match files against" }),
  }),
  name: "glob",
  outputSchema: z.object({
    error: z.string().optional(),
    files: z.array(z.string()),
    totalFiles: z.number(),
    truncated: z.boolean(),
  }),
}).create({
  description:
    "Find files matching a glob pattern in the codebase. Specify a path to search within a specific folder (including a read-only attached folder at /mnt/<name>), or omit to search from the task root.",
  execute: async ({ input, signal, taskId, taskState }) => {
    const layout = buildTaskFsLayout(taskId, taskState);
    const pathResult = resolveAgentPath({
      inputPath: input.path,
      isRequired: false,
      layout,
    });

    if (pathResult.isErr()) {
      return ok({
        error: pathResult.error.message,
        files: [],
        totalFiles: 0,
        truncated: false,
      });
    }

    const { absolutePath: searchRoot, mount } = pathResult.value;

    // Inside an attached mount, glob the real folder and map host paths back
    // to their /mnt/... mount path so the results are usable with the other
    // tools. Mirrors grep; without this the agent gets paths relative to the
    // host folder that read_file would resolve in the wrong place.
    const sorted = await globSortedByMtime({
      absolute: mount !== null,
      cwd: searchRoot,
      pattern: resolveGlobPattern({ cwd: searchRoot, pattern: input.pattern }),
      signal,
    });

    const files = mount
      ? sorted.map((p) => resolveVirtualPath(layout, p) ?? p)
      : sorted;

    const truncated = files.length > GLOB_LIMIT;
    const visible = truncated ? files.slice(0, GLOB_LIMIT) : files;

    return ok({ files: visible, totalFiles: files.length, truncated });
  },
  readOnly: true,
  timeoutMs: ms("15 seconds"),
  toModelOutput: ({ output }) => {
    if (output.error) {
      return {
        type: "error-text",
        value: output.error,
      };
    }
    if (output.files.length === 0) {
      return {
        type: "error-text",
        value: "No files found matching the pattern",
      };
    }

    const lines = [`Found ${output.totalFiles} files`, ...output.files];

    if (output.truncated) {
      lines.push(
        "",
        `(Results truncated: showing first ${GLOB_LIMIT} of ${output.totalFiles} files. Consider using a more specific path or pattern.)`,
      );
    }

    return {
      type: "text",
      value: lines.join("\n"),
    };
  },
});
