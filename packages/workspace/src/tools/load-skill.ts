import ms from "ms";
import { ok } from "neverthrow";
import fsSync from "node:fs";
import path from "node:path";
import { dedent } from "radashi";
import { z } from "zod";

import { TASK_FOLDER_NAMES } from "../constants";
import { copySkill } from "../lib/copy-skill";
import { executeError } from "../lib/execute-error";
import { installPythonSkill } from "../lib/install-python-skill";
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

const SkillInstallResultSchema = z.discriminatedUnion("state", [
  z.object({
    runtime: z.enum(["node", "python"]),
    state: z.literal("success"),
  }),
  z.object({
    exitCode: z.number(),
    output: z.string(),
    runtime: z.enum(["node", "python"]),
    state: z.literal("failure"),
  }),
]);

function hasNodeDependencies(skillDir: string) {
  try {
    const packageJson: unknown = JSON.parse(
      fsSync.readFileSync(path.join(skillDir, "package.json"), "utf8"),
    );
    if (!isRecord(packageJson)) {
      return false;
    }

    return ["dependencies", "optionalDependencies"].some((field) => {
      const dependencies = packageJson[field];
      return isRecord(dependencies) && Object.keys(dependencies).length > 0;
    });
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function skillNeedsDependencyInstall(registryDir: AbsolutePath, name: string) {
  const skillsDir = getSkillSources(registryDir)[0];
  try {
    return (
      skillsDir !== undefined &&
      (hasNodeDependencies(path.join(skillsDir, name)) ||
        fsSync.existsSync(path.join(skillsDir, name, "pyproject.toml")))
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
      installResults: z.array(SkillInstallResultSchema).optional(),
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

      Note: skills with declared Node.js or Python dependencies install them automatically after being copied into the task.
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

    const installResults: z.output<typeof SkillInstallResultSchema>[] = [];

    if (hasNodeDependencies(destDir)) {
      const { combined, exitCode } = await runPnpmCommand({
        args: ["install"],
        cwd: getTaskWorkDir(taskDir(taskId)),
        signal,
        taskId,
      });
      installResults.push(
        exitCode === 0
          ? { runtime: "node", state: "success" }
          : { exitCode, output: combined, runtime: "node", state: "failure" },
      );
    }

    if (fsSync.existsSync(path.join(destDir, "pyproject.toml"))) {
      const installResult = await installPythonSkill({
        signal,
        skillDir: destDir,
        taskId,
      });
      installResults.push({ ...installResult, runtime: "python" });
    }

    const files = copiedFiles.map((f) => `${relativeSkillRoot}/${f}`);

    return ok({
      content: skill.content,
      files,
      ...(installResults.length > 0 ? { installResults } : {}),
      name: skill.name,
      state: "success" as const,
      truncated,
    });
  },
  readOnly: false,
  timeoutMs: ({ input }) => {
    const base = ms("10 seconds");
    const extra = skillNeedsDependencyInstall(
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
      const skillRoot = `${TASK_FOLDER_NAMES.work}/${TASK_FOLDER_NAMES.skills}/${output.name}`;
      const fileSectionText = [
        `The skill files below are copied into your task and are yours to edit.`,
        `Before writing anything new, read the relevant script(s) and run them with \`${TS_COMMAND.name}\` (TypeScript) or \`python\` (Python) if they fit.`,
        `Run a script by its full path from the task root (e.g. \`${TS_COMMAND.name} ${skillRoot}/scripts/<script>.ts ${TASK_FOLDER_NAMES.attachments}/in --output ${TASK_FOLDER_NAMES.output}/out\` or \`python ${skillRoot}/scripts/<script>.py ${TASK_FOLDER_NAMES.attachments}/in --output ${TASK_FOLDER_NAMES.output}/out\`); do NOT \`cd\` into the skill folder to run it, or \`${TASK_FOLDER_NAMES.attachments}/\` and \`${TASK_FOLDER_NAMES.output}/\` won't be where your relative paths point.`,
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
    if (output.installResults) {
      const installText = output.installResults.map((installResult) => {
        if (installResult.state === "failure") {
          const command =
            installResult.runtime === "node"
              ? `${PNPM_COMMAND.name} install`
              : "locked Python dependency installation";
          return [
            `\`${command}\` exited with code ${installResult.exitCode}.`,
            `The skill's ${installResult.runtime} dependencies may not be fully installed.`,
            `Raw output:\n\`\`\`\n${installResult.output}\n\`\`\``,
          ].join(" ");
        }

        return installResult.runtime === "node"
          ? [
              `\`${PNPM_COMMAND.name} install\` was run in \`${TASK_FOLDER_NAMES.work}/\`.`,
              `This is a monorepo -- skill dependencies are scoped to this skill's folder and are ready to use.`,
              `Do not run \`${PNPM_COMMAND.name} add\` for packages this skill already provides.`,
            ].join(" ")
          : [
              `The skill's locked Python dependencies were installed in \`${TASK_FOLDER_NAMES.work}/.venv\`.`,
              `Run its Python scripts with \`python\`; do not install packages the skill already provides.`,
            ].join(" ");
      });
      installSection = `\n\n${installText.join("\n\n")}`;
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
