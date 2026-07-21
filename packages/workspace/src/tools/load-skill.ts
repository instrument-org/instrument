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
import { renderSkillCatalog } from "../lib/skill-catalog";
import { getSkillRuntime } from "../lib/skill-runtime";
import {
  FILE_LIST_LIMIT,
  findSkill,
  findSkills,
  getSkillSources,
  listSkillFiles,
} from "../lib/skills";
import { getTaskWorkDir, taskDir } from "../lib/task-dir-utils";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";
import { TOOL_NAMES } from "./name";
const TAGS = {
  content: "skill_content",
  file: "file",
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
    const sources = getSkillSources(getWorkspaceConfig());
    const skills = await findSkills(sources);
    const catalog = renderSkillCatalog(
      skills.filter((skill) => skill.modelInvocable),
    );

    const examples = catalog.entries
      .slice(0, 3)
      .map((entry) => `'${entry.name}'`)
      .join(", ");
    const hint = examples.length > 0 ? ` (e.g., ${examples})` : "";

    const budgetNotes = [
      catalog.shortened > 0 &&
        `Note: ${catalog.shortened} description(s) were shortened to fit the skills context budget. Load a skill to see its full instructions.`,
      catalog.omitted > 0 &&
        `Note: ${catalog.omitted} further skill(s) were left out of this list entirely. ${TOOL_NAMES.loadSkill} still accepts them by name.`,
    ].filter((note) => typeof note === "string");

    return dedent`
      Load a specialized skill that provides domain-specific instructions, pre-built scripts, and dependencies for a specific task.
      Check for a matching skill before writing custom code or installing packages -- even for tasks that seem simple.

      The skill will inject detailed instructions and workflows into the conversation context.
      Tool output includes a <${TAGS.content} name="..."> block with the loaded content.

      Available skills${hint}:

      ${catalog.xml}

      Note: skills with declared Node.js or Python dependencies install them automatically after being copied into the task.
      ${budgetNotes.join("\n")}
    `.trim();
  },
  execute: async ({ input, signal, taskId }) => {
    const workspaceConfig = getWorkspaceConfig();
    const { all, skill } = await findSkill(workspaceConfig, input.name);

    if (!skill) {
      return ok({
        // Same budgeted catalog as the tool description: a mistyped name should
        // not be the one path that dumps every installed skill into context.
        available: renderSkillCatalog(all.filter((s) => s.modelInvocable))
          .entries,
        name: input.name,
        state: "not-found" as const,
      });
    }

    const runtime = getSkillRuntime(skill.skillDir, skill.name);
    if ("error" in runtime) {
      return executeError(runtime.error);
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

    if (runtime.node) {
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

    if (runtime.python) {
      const installResult = await installPythonSkill({
        signal,
        skillDir: destDir,
        taskId,
      });
      installResults.push({ ...installResult, runtime: "python" });
    }

    // SKILL.md is already inlined above as the skill's content, so listing it
    // again would just spend context restating what the agent is reading.
    const files = copiedFiles
      .filter((f) => f !== "SKILL.md")
      .map((f) => `${relativeSkillRoot}/${f}`);

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
    const skillsDir = getSkillSources(getWorkspaceConfig()).findLast(
      ({ dir }) => fsSync.existsSync(path.join(dir, input.name, "SKILL.md")),
    )?.dir;
    const runtime =
      skillsDir === undefined
        ? { node: false, python: false }
        : getSkillRuntime(path.join(skillsDir, input.name), input.name);
    const extra =
      (runtime.node ? ms("2 minutes") : 0) +
      (runtime.python ? ms("5 minutes") : 0);
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
        `For an operation a script already covers, read it and run it with \`${TS_COMMAND.name}\` (TypeScript) or \`python\` (Python) rather than rewriting it.`,
        `Run a script by its full path from the task root (e.g. \`${TS_COMMAND.name} ${skillRoot}/scripts/<script>.ts ${TASK_FOLDER_NAMES.attachments}/in --output ${TASK_FOLDER_NAMES.output}/out\` or \`python ${skillRoot}/scripts/<script>.py ${TASK_FOLDER_NAMES.attachments}/in --output ${TASK_FOLDER_NAMES.output}/out\`); do NOT \`cd\` into the skill folder to run it, or \`${TASK_FOLDER_NAMES.attachments}/\` and \`${TASK_FOLDER_NAMES.output}/\` won't be where your relative paths point.`,
        `For work the scripts don't cover -- especially content, layout, or anything generative -- write your own code against the skill's preinstalled libraries (see its recipes) instead of bending a script's flags to fit.`,
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
              `The skill's Node.js dependencies are ready to use.`,
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
