import { APP_NAME } from "@instrument-org/shared";
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
import { pathIsWithin } from "../lib/path-is-within";
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
  parseQualifiedSkillName,
  SKILL_CONTENT_LIMIT,
  skillTaskDirName,
  type SkillInfo,
  truncateSkillContent,
} from "../lib/skills";
import { getTaskWorkDir, taskDir } from "../lib/task-dir-utils";
import { getWorkspaceConfig } from "../lib/workspace-config";
import {
  getWorkspaceSkillsDir,
  SKILLS_MOUNT_POINT,
} from "../lib/workspace-fs-layout";
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
  z.object({
    runtime: z.enum(["node", "python"]),
    state: z.literal("skipped"),
  }),
]);

/**
 * Where a loaded skill came from, from the agent's point of view: only the
 * writable `/skills` mount is editable in place, so a skill outside it is
 * read-only wherever it was discovered. `skillDir` is canonicalized, so the
 * mount root is too before the containment check.
 *
 * A skill discovered under the project's `.agents/skills` is also `"workspace"`
 * source but sits outside that mount, so it reports as `"in-repo"`: still the
 * user's own trusted project (dependencies install), but not agent-editable in
 * place, and not "elsewhere on this machine" the way a co-installed agent's
 * home directory is.
 */
async function skillOrigin(
  skill: SkillInfo,
): Promise<"external" | "in-repo" | "instrument" | "workspace"> {
  const workspaceSkillsDir = getWorkspaceSkillsDir();
  const mountRoot = await fsSync.promises
    .realpath(workspaceSkillsDir)
    .catch(() => workspaceSkillsDir);
  if (pathIsWithin(skill.skillDir, mountRoot)) {
    return "workspace";
  }
  if (skill.source === "workspace") {
    return "in-repo";
  }
  return skill.source === "registry" || skill.source === "system"
    ? "instrument"
    : "external";
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
      // True when this task had already copied the skill, so the model is told
      // its own edits to those files survived the reload.
      alreadyLoaded: z.boolean(),
      content: z.string(),
      // True when the body was longer than `SKILL_CONTENT_LIMIT` and only its
      // head was inlined, so the model is told where to read the rest.
      contentTruncated: z.boolean(),
      // Folder the copy landed in under `work/skills`, which is the qualified
      // name made safe for a path.
      directory: z.string(),
      files: z.array(z.string()),
      installResults: z.array(SkillInstallResultSchema).optional(),
      name: z.string(),
      // Where the skill came from, so the model can say so and knows whether it
      // can edit the skill in place: "workspace" lives in the writable /skills
      // mount, the others are read-only where they were discovered.
      origin: z.enum(["external", "in-repo", "instrument", "workspace"]),
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

    // Two sources can ship a skill under one directory name, so the copy is
    // named after the qualified one and each of them lands in its own folder.
    const directory = skillTaskDirName(skill.qualifiedName);
    const { alreadyLoaded, destDir } = await copySkill({
      dir: taskDir(taskId),
      signal,
      skillDir: skill.skillDir,
      skillName: directory,
    });

    const relativeSkillRoot = normalizedPathJoin(
      TASK_FOLDER_NAMES.work,
      TASK_FOLDER_NAMES.skills,
      directory,
    );
    const { files: copiedFiles, truncated } = await listSkillFiles(
      destDir,
      signal,
    );

    const origin = await skillOrigin(skill);

    // Third-party skills discovered in another tool's folder on this machine are
    // never eagerly installed: their declared dependencies are code we'd fetch
    // and run before anyone has vetted the skill. First-party and workspace
    // skills are trusted enough to provision on load.
    const installDependencies = origin !== "external";

    const installResults: z.output<typeof SkillInstallResultSchema>[] = [];

    if (runtime.node) {
      if (installDependencies) {
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
      } else {
        installResults.push({ runtime: "node", state: "skipped" });
      }
    }

    if (runtime.python) {
      if (installDependencies) {
        const installResult = await installPythonSkill({
          signal,
          skillDir: destDir,
          taskId,
        });
        installResults.push({ ...installResult, runtime: "python" });
      } else {
        installResults.push({ runtime: "python", state: "skipped" });
      }
    }

    // SKILL.md is already inlined above as the skill's content, so listing it
    // again would just spend context restating what the agent is reading.
    const files = copiedFiles
      .filter((f) => f !== "SKILL.md")
      .map((f) => `${relativeSkillRoot}/${f}`);

    const body = truncateSkillContent(skill.content);

    return ok({
      alreadyLoaded,
      content: body.content,
      contentTruncated: body.truncated,
      directory,
      files,
      ...(installResults.length > 0 ? { installResults } : {}),
      name: skill.qualifiedName,
      origin,
      state: "success" as const,
      truncated,
    });
  },
  readOnly: false,
  timeoutMs: ({ input }) => {
    const base = ms("10 seconds");
    // A qualified name says which source to look in, so the runtime read here
    // is the one that will be loaded rather than a namesake from elsewhere.
    const { name, source } = parseQualifiedSkillName(input.name);
    const skillsDir = getSkillSources(getWorkspaceConfig()).findLast(
      (candidate) =>
        (source === undefined || candidate.source === source) &&
        fsSync.existsSync(path.join(candidate.dir, name, "SKILL.md")),
    )?.dir;
    const runtime =
      skillsDir === undefined
        ? { node: false, python: false }
        : getSkillRuntime(path.join(skillsDir, name), name);
    const extra =
      "error" in runtime
        ? 0
        : (runtime.node ? ms("2 minutes") : 0) +
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

    const skillRoot = `${TASK_FOLDER_NAMES.work}/${TASK_FOLDER_NAMES.skills}/${output.directory}`;

    const contentSection = output.contentTruncated
      ? `\n\nThis skill's SKILL.md is longer than ${SKILL_CONTENT_LIMIT} characters, so only its beginning is above. Read \`${skillRoot}/SKILL.md\` for the rest before following it.`
      : "";

    const reloadSection = output.alreadyLoaded
      ? `\n\nYou had already loaded this skill in this task. Its files are still at \`${skillRoot}\` with any changes you made to them, and anything missing from that folder was restored.`
      : "";

    let fileSection = "";
    if (output.files.length > 0) {
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

    const customizeHint = `Copy it into \`${SKILLS_MOUNT_POINT}/\` to change it.`;
    // A workspace skill always keeps its plain directory name, so `directory`
    // is also what it is called where it lives.
    const originSection =
      output.origin === "workspace"
        ? `\n\nThis skill lives at \`${SKILLS_MOUNT_POINT}/${output.directory}\`; edit it there to change the skill for future tasks (the \`${TASK_FOLDER_NAMES.work}/\` copy is only for this task).`
        : output.origin === "in-repo"
          ? `\n\nThis skill lives in this project at \`.agents/skills/${output.directory}\`, outside the writable \`${SKILLS_MOUNT_POINT}/\` mount, so you cannot edit it in place from here. ${customizeHint}`
          : output.origin === "instrument"
            ? `\n\nThis skill is provided by ${APP_NAME} and is read-only. ${customizeHint}`
            : `\n\nThis skill comes from a skills folder elsewhere on this machine and is read-only. ${customizeHint}`;

    let installSection = "";
    if (output.installResults) {
      const installText = output.installResults.map((installResult) => {
        if (installResult.state === "skipped") {
          const installHint =
            installResult.runtime === "node"
              ? `run \`cd ${skillRoot} && ${PNPM_COMMAND.name} install\``
              : `install its locked dependencies into \`${TASK_FOLDER_NAMES.work}/.venv\``;
          return [
            `This skill declares ${installResult.runtime === "node" ? "Node.js" : "Python"} dependencies, but ${APP_NAME} did not install them because the skill comes from a third-party skills folder on this machine.`,
            `Review the skill first, then ${installHint} yourself if you trust it.`,
          ].join(" ");
        }

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
        contentSection +
        originSection +
        reloadSection +
        fileSection +
        installSection +
        `\n</${TAGS.content}>`,
    };
  },
});
