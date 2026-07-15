import ms from "ms";
import { err, ok } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import { grep } from "../lib/grep";
import { resolveAgentPath } from "../lib/resolve-agent-path";
import { taskDir } from "../lib/task-dir-utils";
import {
  buildWorkspaceFsLayout,
  resolveVirtualPath,
} from "../lib/workspace-fs-layout";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

const INPUT_PARAMS = {
  include: "include",
  path: "path",
  pattern: "pattern",
} as const;

const GREP_LIMIT = 100;

export const Grep = setupTool({
  inputSchema: BaseInputSchema.extend({
    [INPUT_PARAMS.include]: z.string().optional().meta({
      description:
        'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
    }),
    [INPUT_PARAMS.path]: z.string().optional().meta({
      description:
        "The directory to search in (relative to task root), or a read-only attached-folder mount path (/mnt/<name>). Defaults to the task root if not specified.",
    }),
    [INPUT_PARAMS.pattern]: z
      .string()
      .meta({ description: "Valid ripgrep pattern to search for" }),
  }),
  name: "grep",
  outputSchema: z.object({
    hasErrors: z.boolean().optional().default(false),
    matches: z.array(
      z.object({
        lineNum: z.number(),
        lineText: z.string(),
        modifiedAt: z.number(),
        path: z.string(),
      }),
    ),
    totalMatches: z.number(),
    truncated: z.boolean(),
  }),
}).create({
  description: dedent`
    - Fast content search tool that uses ripgrep (rg) that works with any codebase size.
    - Searches file contents using regular expressions.
    - Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.).
    - Uses smart case by default: searches case insensitively if ${INPUT_PARAMS.pattern} is all lowercase, otherwise searches case sensitively.
    - Filter files by pattern with the ${INPUT_PARAMS.include} parameter (eg. "*.js", "*.{ts,tsx}").
    - Search in specific directories by providing a ${INPUT_PARAMS.path} parameter.
    - The ${INPUT_PARAMS.path} parameter must be a relative path. E.g. ./path/to/search
    - Returns file paths with line numbers and content, sorted by modification time.
    - Use this tool when you need to find files containing specific patterns.
  `,
  execute: async ({ input, signal, taskId, taskState }) => {
    if (input.path) {
      const layout = buildWorkspaceFsLayout({
        attachedFolders: taskState.attachedFolders,
        taskHostRoot: taskDir(taskId),
      });
      const pathResult = resolveAgentPath({ inputPath: input.path, layout });
      if (pathResult.isErr()) {
        return err(pathResult.error);
      }
      const { absolutePath, attachedMount, displayPath } = pathResult.value;

      // Inside an attached mount (/mnt/<name>/...), search the real folder on
      // disk; otherwise search the task-relative displayPath.
      const result = await grep({
        cwd: taskDir(taskId),
        include: input.include,
        limit: GREP_LIMIT,
        pattern: input.pattern,
        searchPath: attachedMount ? absolutePath : displayPath,
        signal,
      });

      if (!attachedMount) {
        return ok(result);
      }

      // Map ripgrep's host paths back to their virtual mount path so no host
      // path leaks and a follow-up read_file resolves to the same place.
      return ok({
        ...result,
        matches: result.matches.map((match) => ({
          ...match,
          path: resolveVirtualPath(layout, match.path) ?? match.path,
        })),
      });
    }

    // No path specified, search from root
    const result = await grep({
      cwd: taskDir(taskId),
      include: input.include,
      limit: GREP_LIMIT,
      pattern: input.pattern,
      searchPath: "./",
      signal,
    });

    return ok(result);
  },
  readOnly: true,
  timeoutMs: ms("30 seconds"),
  toModelOutput: ({ output }) => {
    if (output.matches.length === 0) {
      return {
        type: "text",
        value: "No matches found",
      };
    }

    // Sort by modification time (newest first)
    const sortedMatches = [...output.matches].sort(
      (a, b) => b.modifiedAt - a.modifiedAt,
    );

    const outputLines = [`Found ${output.matches.length} matches`];

    let currentFile = "";
    for (const match of sortedMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("");
        }
        currentFile = match.path;
        outputLines.push(`${match.path}:`);
      }
      outputLines.push(`  Line ${match.lineNum}: ${match.lineText}`);
    }

    if (output.truncated) {
      outputLines.push(
        "",
        `(Results truncated: showing ${GREP_LIMIT} of ${output.totalMatches} matches (${output.totalMatches - GREP_LIMIT} hidden). Consider using a more specific path or pattern.)`,
      );
    }

    if (output.hasErrors) {
      outputLines.push("", "(Some paths were inaccessible and skipped)");
    }

    return {
      type: "text",
      value: outputLines.join("\n"),
    };
  },
});
