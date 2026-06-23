import ms from "ms";
import { ok } from "neverthrow";
import fsSync from "node:fs";
import path from "node:path";
import { dedent } from "radashi";
import { z } from "zod";

import { TASK_FOLDER_NAMES } from "../constants";
import { copySkill } from "../lib/copy-skill";
import { executeError } from "../lib/execute-error";
import { normalizedPathJoin } from "../lib/normalize-path";
import { runPnpmCommand } from "../lib/run-pnpm";
import { PNPM_COMMAND } from "../lib/shell-commands/pnpm";
import { TS_COMMAND } from "../lib/shell-commands/ts";
import {
  FILE_LIST_LIMIT,
  findSkill,
  findSkills,
  getSkillSources,
  listSkillFiles,
} from "../lib/skills";
import { getTaskWorkDir, taskDir } from "../lib/task-dir-utils";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { type AbsolutePath } from "../schemas/paths";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";
const TAGS = {
  availableSkills: "available_skills",
  content: "skill_content",
  description: "description",
  file: "file",
  name: "name",
  skill: "skill",
  skillFiles: "skill_files",
} as const;

function skillHasPackageJson(registryDir: AbsolutePath, name: string) {
  const skillsDir = getSkillSources(registryDir)[0];
  try {
    return (
      skillsDir !== undefined &&
      fsSync.existsSync(path.join(skillsDir, name, "package.json"))
    );
  } catch {
    return false;
  }
}

export const LoadSkill = setupTool({
  inputSchema: BaseInputSchema.extend({
    name: z.string().meta({
      description: "The name of the skill to load.",
    }),
  }),
  name: "load_skill",
  outputSchema: z.discriminatedUnion("state", [
    z.object({
      content: z.string(),
      files: z.array(z.string()),
      installResult: z
        .discriminatedUnion("state", [
          z.object({ state: z.literal("success") }),
          z.object({
            exitCode: z.number(),
            output: z.string(),
            state: z.literal("failure"),
          }),
        ])
        .optional(),
      name: z.string(),
      state: z.literal("success"),
      truncated: z.boolean(),
    }),
    z.object({
      available: z.array(
        z.object({ description: z.string(), name: z.string() }),
      ),
      name: z.string(),
      state: z.literal("not-found"),
    }),
  ]),
}).create({
  description: async () => {
    const sources = getSkillSources(getWorkspaceConfig().registryDir);
    const skills = await findSkills(sources);

    const skillsBlock =
      skills.length === 0
        ? `<${TAGS.availableSkills} />`
        : dedent`
            <${TAGS.availableSkills}>
            ${skills
              .map((s) =>
                [
                  `  <${TAGS.skill}>`,
                  `    <${TAGS.name}>${s.name}</${TAGS.name}>`,
                  `    <${TAGS.description}>${s.description}</${TAGS.description}>`,
                  `  </${TAGS.skill}>`,
                ].join("\n"),
              )
              .join("\n")}
            </${TAGS.availableSkills}>
          `;

    const examples = skills
      .map((s) => `'${s.name}'`)
      .slice(0, 3)
      .join(", ");
    const hint = examples.length > 0 ? ` (e.g., ${examples})` : "";

    return dedent`
      Load a specialized skill that provides domain-specific instructions, pre-built scripts, and dependencies for a specific task.
      Check for a matching skill before writing custom code or installing packages -- even for tasks that seem simple.

      The skill will inject detailed instructions and workflows into the conversation context.
      Tool output includes a <${TAGS.content} name="..."> block with the loaded content.

      Available skills${hint}:

      ${skillsBlock}

      Note: if the skill includes a package.json, pnpm install will be run automatically in the task after the skill is copied.
    `.trim();
  },
  execute: async ({ input, signal, taskId }) => {
    const { registryDir } = getWorkspaceConfig();
    const { all, skill } = await findSkill(registryDir, input.name);

    if (!skill) {
      return ok({
        available: all.map((s) => ({
          description: s.description,
          name: s.name,
        })),
        name: input.name,
        state: "not-found" as const,
      });
    }

    const copyResult = await copySkill({
      dir: taskDir(taskId),
      signal,
      skillDir: skill.skillDir,
      skillName: skill.name,
    });

    if (copyResult.isErr()) {
      return executeError(copyResult.error.message);
    }

    const destDir = copyResult.value;
    const relativeSkillRoot = normalizedPathJoin(
      TASK_FOLDER_NAMES.work,
      TASK_FOLDER_NAMES.skills,
      skill.name,
    );
    const { files: copiedFiles, truncated } = await listSkillFiles(
      destDir,
      signal,
    );

    const hasPackageJson = copiedFiles.includes("package.json");

    let installResult:
      | undefined
      | { exitCode: number; output: string; state: "failure" }
      | { state: "success" };

    if (hasPackageJson) {
      const { combined, exitCode } = await runPnpmCommand({
        args: ["install"],
        cwd: getTaskWorkDir(taskDir(taskId)),
        signal,
        taskId,
      });
      installResult =
        exitCode === 0
          ? { state: "success" as const }
          : { exitCode, output: combined, state: "failure" as const };
    }

    const files = copiedFiles.map((f) => `${relativeSkillRoot}/${f}`);

    return ok({
      content: skill.content,
      files,
      installResult,
      name: skill.name,
      state: "success" as const,
      truncated,
    });
  },
  readOnly: false,
  timeoutMs: ({ input }) => {
    const base = ms("10 seconds");
    const extra = skillHasPackageJson(
      getWorkspaceConfig().registryDir,
      input.name,
    )
      ? ms("2 minutes")
      : 0;
    return base + extra;
  },
  toModelOutput: ({ output }) => {
    if (output.state === "not-found") {
      const listing =
        output.available.length === 0
          ? "No skills are currently available."
          : output.available
              .map((s) => `- ${s.name}: ${s.description}`)
              .join("\n");
      return {
        type: "error-text",
        value: `Skill "${output.name}" not found.\n\nAvailable skills:\n\n${listing}`,
      };
    }

    let fileSection = "";
    if (output.files.length > 0) {
      const fileSectionText = [
        `The skill files below are copied into your task and are yours to edit.`,
        `Before writing anything new, read the relevant script(s) and run them with \`${TS_COMMAND.name}\` if they fit.`,
        `Only write a custom script if the existing ones cannot handle the task even with modification.`,
      ].join(" ");

      const fileListXml = [
        `<${TAGS.skillFiles}>`,
        ...output.files.map((f) => `<${TAGS.file}>${f}</${TAGS.file}>`),
        `</${TAGS.skillFiles}>`,
      ].join("\n");

      const truncationNote = output.truncated
        ? `\nNote: file list truncated at ${FILE_LIST_LIMIT} entries.`
        : "";

      fileSection = `\n\n${fileSectionText}\n\n${fileListXml}${truncationNote}`;
    }

    let installSection = "";
    if (output.installResult) {
      const text =
        output.installResult.state === "success"
          ? [
              `\`${PNPM_COMMAND.name} install\` was run in \`${TASK_FOLDER_NAMES.work}/\`.`,
              `This is a monorepo -- skill dependencies are scoped to this skill's folder and are ready to use.`,
              `Do not run \`${PNPM_COMMAND.name} add\` for packages this skill already provides.`,
            ].join(" ")
          : [
              `\`${PNPM_COMMAND.name} install\` was run in \`${TASK_FOLDER_NAMES.work}/\` but exited with code ${output.installResult.exitCode}.`,
              `The skill's dependencies may not be fully installed.`,
              `Raw output:\n\`\`\`\n${output.installResult.output}\n\`\`\``,
            ].join(" ");
      installSection = `\n\n${text}`;
    }

    return {
      type: "text",
      value:
        `<${TAGS.content} name="${output.name}">\n` +
        output.content +
        fileSection +
        installSection +
        `\n</${TAGS.content}>`,
    };
  },
});
