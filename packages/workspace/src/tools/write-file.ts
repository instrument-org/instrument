import ms from "ms";
import { err, ok } from "neverthrow";
import fs from "node:fs/promises";
// Adapted from
// https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/write.ts
import { dedent } from "radashi";
import { z } from "zod";

import { TASK_FOLDER_NAMES, TOOL_EXPLANATION_PARAM_NAME } from "../constants";
import { executeError } from "../lib/execute-error";
import { pathExists } from "../lib/path-exists";
import { resolveWritableToolPath } from "../lib/resolve-agent-path";
import { taskDir } from "../lib/task-dir-utils";
import { resolveTaskProjectFolder } from "../lib/task-project-folder";
import { buildWorkspaceFsLayout } from "../lib/workspace-fs-layout";
import { writeFileWithDir } from "../lib/write-file-with-dir";
import { MOUNT } from "../mount-points";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";
import { ReadFile } from "./read-file";

const INPUT_PARAMS = {
  content: "content",
  filePath: "filePath",
} as const;

export const WriteFile = setupTool({
  inputSchema: BaseInputSchema.extend({
    /* eslint-disable perfectionist/sort-objects */
    // Sorting the file path first to attempt to get model to generate it first
    [INPUT_PARAMS.filePath]: z.string().meta({
      description: `The path of the file to write. Generate this after ${TOOL_EXPLANATION_PARAM_NAME}.`,
    }),
    [INPUT_PARAMS.content]: z
      .string()
      .meta({ description: "The content to write to the file" }),
    /* eslint-enable perfectionist/sort-objects */
  }),
  name: "write_file",
  outputSchema: z.object({
    content: z.string(),
    // Task-relative, or the mount path of a writable attached folder.
    filePath: z.string(),
    isNewFile: z.boolean(),
    modifiedAt: z.number(),
  }),
}).create({
  description: dedent`
    Writes a file, creating parent directories as needed.

    Usage:
    - The ${INPUT_PARAMS.filePath} parameter is a path relative to the task (e.g. ./${TASK_FOLDER_NAMES.output}/report.md), or the mount path of an attached folder you have read-and-write access to (${MOUNT.attachedFolders}/<name>/report.md). The attached-folders list in your context says which folders those are.
    - Writing to an existing path overwrites it, so read it with \`${ReadFile.name}\` first when you have not seen its current contents.
    - Never use this tool to re-emit content you already produced or read from disk, including to move a file somewhere the user can see it. That wastes tokens and corrupts bytes (line endings, whitespace, base64-ish or minified content). Copy or move it instead: \`cp work/foo.html output/foo.html\`.
  `,
  execute: async ({ input, signal, taskId, taskState }) => {
    const layout = buildWorkspaceFsLayout({
      attachedFolders: taskState.attachedFolders,
      projectFolderName: await resolveTaskProjectFolder(taskId),
      taskHostRoot: taskDir(taskId),
    });
    const pathResult = resolveWritableToolPath({
      inputPath: input.filePath,
      layout,
    });
    if (pathResult.isErr()) {
      return err(pathResult.error);
    }
    const { absolutePath, displayPath: fixedPath } = pathResult.value;

    const isNewFile = !(await pathExists(absolutePath));

    try {
      await writeFileWithDir(absolutePath, input.content, { signal });
      const stats = await fs.stat(absolutePath);

      return ok({
        content: input.content,
        filePath: fixedPath,
        isNewFile,
        modifiedAt: stats.mtimeMs,
      });
    } catch (error) {
      return executeError(
        `Failed to write file ${fixedPath}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },
  readOnly: false,
  timeoutMs: ms("30 seconds"),
  toModelOutput: ({ output }) => {
    const baseContent = output.isNewFile
      ? "Successfully wrote new file"
      : "Successfully overwrote existing file";

    return {
      type: "text",
      value: `${baseContent} ${output.filePath}`,
    };
  },
});
