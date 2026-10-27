import ms from "ms";
import { err, ok } from "neverthrow";
// Adapted from
// https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/write.ts
import { dedent } from "radashi";
import { z } from "zod";

import { TOOL_EXPLANATION_PARAM_NAME } from "../constants";
import { sessionToolFs } from "../lib/tool-fs";
import { defineCapability } from "../lib/capabilities/define";
import { modelTool } from "../lib/capabilities/tool";
import { ReadFile } from "./read-file";

const INPUT_PARAMS = {
  content: "content",
  filePath: "filePath",
} as const;

const writeFileCapability = defineCapability({
  input: z.object({
    // Sorting the file path first to attempt to get model to generate it first
    [INPUT_PARAMS.filePath]: z.string().meta({
      description: `The path of the file to write. Generate this after ${TOOL_EXPLANATION_PARAM_NAME}.`,
    }),
    [INPUT_PARAMS.content]: z
      .string()
      .meta({ description: "The content to write to the file" }),
  }),
  name: "files.write",
  summary: "Writes a file in the work folder or one of the user's folders.",
  surfaces: {
    tool: {
      description: dedent`
    Writes a file, creating parent directories as needed.

    Usage:
    - The ${INPUT_PARAMS.filePath} parameter is a path relative to your work folder (e.g. ./sales/report.md), or the full path of a file in one of the user's folders you may change. The folders list in your context says which folders those are.
    - Writing to an existing path overwrites it, so read it with \`${ReadFile.name}\` first when you have not seen its current contents.
    - Never use this tool to re-emit content you already produced or read from disk, including to move a file somewhere the user can see it. That wastes tokens and corrupts bytes (line endings, whitespace, base64-ish or minified content). Copy or move it instead: \`cp site/foo.html <folder>/foo.html\`.  `,
      execute: async ({ input, partId, sessionId, chatId }) => {
        const files = await sessionToolFs({ chatId, partId, sessionId });
        const typed = files.resolve(input.filePath);
        if (typed.isErr()) {
          return err(typed.error);
        }
        const target = typed.value;

        const isNewFile = !(await files.fs.exists(target));

        try {
          // Makes the folders it needs, as `tee` does.
          await files.fs.writeFile(target, input.content);
          const stats = await files.fs.stat(target);

          return ok({
            content: input.content,
            filePath: files.shown(target),
            isNewFile,
            modifiedAt: stats.mtime.getTime(),
          });
        } catch (error) {
          return files.failure(error, target);
        }
      },
      readOnly: false,
      timeoutMs: () => ms("30 seconds"),
      toModelOutput: ({ output }) => {
        const baseContent = output.isNewFile
          ? "Successfully wrote new file"
          : "Successfully overwrote existing file";

        return {
          type: "text",
          value: `${baseContent} ${output.filePath}`,
        };
      },
      name: "write_file",
      output: z.object({
        content: z.string(),
        // Relative to the chat's folder, or the absolute path in a writable folder.
        filePath: z.string(),
        isNewFile: z.boolean(),
        modifiedAt: z.number(),
      }),
    },
  },
});

export const WriteFile = modelTool(writeFileCapability);
