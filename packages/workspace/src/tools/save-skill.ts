import ms from "ms";
import { ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { dedent } from "radashi";
import { z } from "zod";

import { REGISTRY_FOLDER_NAMES } from "../constants";
import { absolutePathJoin } from "../lib/absolute-path-join";
import { executeError } from "../lib/execute-error";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { writeFileWithDir } from "../lib/write-file-with-dir";
import { AbsolutePathSchema } from "../schemas/paths";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_RESOURCE_COUNT = 50;
const MAX_FILE_SIZE = 1_000_000;

const ResourceSchema = z.object({
  content: z.string().max(MAX_FILE_SIZE).meta({
    description: "The complete UTF-8 text content for this resource.",
  }),
  path: z.string().min(1).meta({
    description: "A relative POSIX path within the skill package.",
  }),
});

export const SaveSkill = setupTool({
  inputSchema: BaseInputSchema.extend({
    description: z.string().trim().min(1).max(1024).meta({
      description:
        "What the skill does and the contexts that should trigger it.",
    }),
    instructions: z.string().trim().min(1).max(MAX_FILE_SIZE).meta({
      description: "The Markdown body of SKILL.md, without YAML frontmatter.",
    }),
    name: z
      .string()
      .trim()
      .min(1)
      .max(63)
      .regex(SKILL_NAME_PATTERN)
      .meta({
        description:
          "A lowercase skill name containing only letters, digits, and hyphens.",
      }),
    resources: z
      .array(ResourceSchema)
      .max(MAX_RESOURCE_COUNT)
      .optional()
      .meta({
        description: "Optional text resources bundled with the skill.",
      }),
  }),
  name: "save_skill",
  outputSchema: z.object({
    files: z.array(z.string()),
    name: z.string(),
    path: z.string(),
  }),
}).create({
  description: dedent`
    Create a new reusable skill in the user's Instrument workspace.

    Use this after loading the skill-creator skill and agreeing on the finished
    package with the user. The tool creates skills/<name>/SKILL.md and optional
    text resources. It refuses to replace an existing skill.

    Resource paths must be relative POSIX paths inside the skill directory.
    Use scripts/, references/, or assets/ when the package needs supporting
    files. Do not include SKILL.md in resources because the tool generates it
    from name, description, and instructions.
  `,
  execute: async ({ input, signal }) => {
    const workspaceConfig = getWorkspaceConfig();
    const skillsDir = absolutePathJoin(
      workspaceConfig.rootDir,
      REGISTRY_FOLDER_NAMES.skills,
    );
    const skillDir = absolutePathJoin(skillsDir, input.name);
    const resources = input.resources ?? [];
    const resourcePaths = new Set<string>();

    for (const resource of resources) {
      const validationError = validateResourcePath(resource.path);
      if (validationError) {
        return executeError(validationError);
      }
      const normalized = path.posix.normalize(resource.path);
      if (resourcePaths.has(normalized)) {
        return executeError(`Duplicate skill resource path: ${normalized}`);
      }
      resourcePaths.add(normalized);
    }

    let temporaryDir: string | undefined;
    try {
      await fs.mkdir(skillsDir, { recursive: true });
      const skillsStats = await fs.lstat(skillsDir);
      if (!skillsStats.isDirectory() || skillsStats.isSymbolicLink()) {
        return executeError("The workspace skills path is not a directory.");
      }

      try {
        await fs.lstat(skillDir);
        return executeError(`Skill "${input.name}" already exists.`);
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }

      temporaryDir = await fs.mkdtemp(path.join(skillsDir, ".creating-"));
      const skillMarkdown = [
        "---",
        `name: ${input.name}`,
        `description: ${JSON.stringify(input.description)}`,
        "---",
        "",
        input.instructions.trim(),
        "",
      ].join("\n");
      await writeFileWithDir(
        AbsolutePathSchema.parse(path.join(temporaryDir, "SKILL.md")),
        skillMarkdown,
        { signal },
      );

      for (const resource of resources) {
        await writeFileWithDir(
          AbsolutePathSchema.parse(
            path.join(temporaryDir, path.posix.normalize(resource.path)),
          ),
          resource.content,
          { signal },
        );
      }

      await fs.rename(temporaryDir, skillDir);
      temporaryDir = undefined;

      return ok({
        files: ["SKILL.md", ...resourcePaths],
        name: input.name,
        path: `skills/${input.name}`,
      });
    } catch (error) {
      return executeError(
        `Failed to create skill "${input.name}": ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      if (temporaryDir) {
        try {
          await fs.rm(temporaryDir, { force: true, recursive: true });
        } catch (error) {
          workspaceConfig.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { scopes: ["workspace"] },
          );
        }
      }
    }
  },
  readOnly: false,
  timeoutMs: ms("30 seconds"),
  toModelOutput: ({ output }) => ({
    type: "text",
    value: `Created skill "${output.name}" at ${output.path}.`,
  }),
});

function isMissingPathError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function validateResourcePath(inputPath: string): string | undefined {
  if (inputPath.includes("\\") || path.posix.isAbsolute(inputPath)) {
    return `Skill resource path must be relative and use forward slashes: ${inputPath}`;
  }

  const normalized = path.posix.normalize(inputPath);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return `Skill resource path escapes the skill directory: ${inputPath}`;
  }
  if (path.posix.basename(normalized).toLowerCase() === "skill.md") {
    return "SKILL.md is generated by save_skill and cannot be a resource.";
  }
  return undefined;
}
