import { APP_NAME } from "@instrument-org/shared";
import ms from "ms";
import { ok } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import { CHAT_FOLDER_NAMES } from "../constants";
import { copySkill } from "../lib/copy-skill";
import { executeError } from "../lib/execute-error";
import { installPythonSkill } from "../lib/install-python-skill";
import { normalizedPathJoin } from "../lib/normalize-path";
import { runPnpmCommand } from "../lib/run-pnpm";
import { NODE_COMMAND } from "../lib/shell-commands/node";
import { PNPM_COMMAND } from "../lib/shell-commands/pnpm";
import { renderSkillCatalog } from "../lib/skill-catalog";
import {
  getSkillProvenance,
  getWritableSkillsRoot,
  SKILL_ORIGINS,
} from "../lib/skill-provenance";
import { getSkillRuntime } from "../lib/skill-runtime";
import {
  FILE_LIST_LIMIT,
  findSkills,
  getSkillSources,
  listSkillFiles,
  resolveSkillName,
  SKILL_CONTENT_LIMIT,
  truncateSkillContent,
} from "../lib/skills";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { buildWorkspaceFsLayout } from "../lib/workspace-fs-layout";
import { WORKSPACE_SKILLS_MOUNT } from "../mount-points";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";
import { workDir } from "../lib/work-dir";
const TAGS = {
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
      // Relative folder the copy landed in under `work/skills`.
      directory: z.string(),
      files: z.array(z.string()),
      installResults: z.array(SkillInstallResultSchema).optional(),
      name: z.string(),
      // Where the skill came from, so the model can say so and knows whether it
      // can edit the skill in place: "workspace" lives in the writable
      // /skills/workspace mount, the others are read-only where they were discovered.
      origin: z.enum(SKILL_ORIGINS),
      skillName: z.string(),
      state: z.literal("success"),
      truncated: z.boolean(),
    }),
    z.object({
      available: z.array(
        z.object({ description: z.string(), name: z.string() }),
      ),
      name: z.string(),
      state: z.literal("not-found"),
      // Qualified names the request was close to: what several skills answer
      // to when the plain name it asked for reaches none of them on its own.
      suggestions: z.array(z.string()),
    }),
  ]),
}).create({
  // Static on purpose. The catalog this used to render was rediscovered per
  // request, so a skill installed or edited mid-session rewrote a tool
  // definition at the front of the prompt. The catalog now lives in the
  // session's context message; what stays here is the part that only changes
  // when the tool itself does.
  description: dedent`
    Load a specialized skill that provides domain-specific instructions, pre-built scripts, and dependencies for a specific task.
    Check for a matching skill before writing custom code or installing packages -- even for tasks that seem simple.

    The skills available to you are listed in the \`<available_skills>\` block in the conversation, plus any later message naming a skill added since. Pass \`name\` exactly as it appears there. If no skill answers to that name, this tool returns the current list, so a name you are unsure of costs one call rather than a guess.

    The skill will inject detailed instructions and workflows into the conversation context.

    Note: skills with declared Node.js or Python dependencies install them automatically after being copied into the task.
  `.trim(),
  execute: async ({ input, signal, chatId }) => {
    const workspaceConfig = getWorkspaceConfig();
    const all = await findSkills(getSkillSources(workspaceConfig));
    const resolved = resolveSkillName(all, input.name);

    if (!("skill" in resolved)) {
      return ok({
        // Same budgeted catalog as the tool description: a mistyped name should
        // not be the one path that dumps every installed skill into context.
        available: renderSkillCatalog(all.filter((s) => s.modelInvocable))
          .entries,
        name: input.name,
        state: "not-found" as const,
        suggestions: resolved.suggestions,
      });
    }

    const skill = resolved.skill;

    const runtime = getSkillRuntime(skill.skillDir, skill.name);
    if ("error" in runtime) {
      return executeError(runtime.error);
    }

    // Source and name remain separate path segments. Turning an address into a
    // filesystem-safe string would let distinct skills collapse onto one copy.
    const directory = normalizedPathJoin(skill.sourceId, skill.name);
    const { alreadyLoaded, destDir } = await copySkill({
      dir: workDir(chatId),
      signal,
      skillDir: skill.skillDir,
      skillName: skill.name,
      skillSource: skill.sourceId,
    });

    const relativeSkillRoot = normalizedPathJoin(
      CHAT_FOLDER_NAMES.work,
      CHAT_FOLDER_NAMES.skills,
      directory,
    );
    const { files: copiedFiles, truncated } = await listSkillFiles(
      destDir,
      signal,
    );

    const provenance = getSkillProvenance(
      skill,
      await getWritableSkillsRoot(workspaceConfig.rootDir),
    );

    // Third-party skills discovered in another tool's folder on this machine are
    // never eagerly installed: their declared dependencies are code we'd fetch
    // and run before anyone has vetted the skill. First-party and workspace
    // skills are trusted enough to provision on load.
    const installResults: z.output<typeof SkillInstallResultSchema>[] = [];

    if (runtime.node) {
      if (provenance.installDependencies) {
        const { exitCode, stderr, stdout } = await runPnpmCommand({
          args: ["install"],
          cwd: workDir(chatId),
          layout: buildWorkspaceFsLayout({ taskHostRoot: workDir(chatId) }),
          signal,
          chatId,
        });
        installResults.push(
          exitCode === 0
            ? { runtime: "node", state: "success" }
            : {
                exitCode,
                output: stdout + stderr,
                runtime: "node",
                state: "failure",
              },
        );
      } else {
        installResults.push({ runtime: "node", state: "skipped" });
      }
    }

    if (runtime.python) {
      if (provenance.installDependencies) {
        const installResult = await installPythonSkill({
          signal,
          skillDir: destDir,
          chatId,
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
      name: skill.id,
      origin: provenance.origin,
      skillName: skill.name,
      state: "success" as const,
      truncated,
    });
  },
  readOnly: false,
  // A deadline, not a delay: dependency-free skills still return immediately.
  // Keeping the maximum removes a second, synchronous skill resolver that can
  // drift from execution and under-budget an alias or stable ID.
  timeoutMs: ms("7 minutes") + ms("10 seconds"),
  toModelOutput: ({ output }) => {
    if (output.state === "not-found") {
      const listing =
        output.available.length === 0
          ? "No skills are currently available."
          : output.available
              .map((s) => `- ${s.name}: ${s.description}`)
              .join("\n");
      const didYouMean =
        output.suggestions.length > 0
          ? `\n\nSeveral skills answer to that name. Load one of them by its full name: ${output.suggestions.join(", ")}.`
          : "";
      return {
        type: "error-text",
        value: `Skill "${output.name}" not found.${didYouMean}\n\nAvailable skills:\n\n${listing}`,
      };
    }

    const skillRoot = `${CHAT_FOLDER_NAMES.work}/${CHAT_FOLDER_NAMES.skills}/${output.directory}`;

    const contentSection = output.contentTruncated
      ? `\n\nThis skill's SKILL.md is longer than ${SKILL_CONTENT_LIMIT} characters, so only its beginning is below. Read \`${skillRoot}/SKILL.md\` for the rest before following it.`
      : "";

    const reloadSection = output.alreadyLoaded
      ? `\n\nYou had already loaded this skill in this task. Its files are still at \`${skillRoot}\` with any changes you made to them, and anything missing from that folder was restored.`
      : "";

    let fileSection = "";
    if (output.files.length > 0) {
      const fileSectionText = [
        `The skill files below are copied into your task and are yours to edit.`,
        `For an operation a script already covers, read it and run it with \`${NODE_COMMAND.name}\` (TypeScript) or \`python\` (Python) rather than rewriting it.`,
        `Run a script by its full path from the task root (e.g. \`${NODE_COMMAND.name} ${skillRoot}/scripts/<script>.ts ${CHAT_FOLDER_NAMES.attachments}/in --output ${CHAT_FOLDER_NAMES.work}/out\` or \`python ${skillRoot}/scripts/<script>.py ${CHAT_FOLDER_NAMES.attachments}/in --output ${CHAT_FOLDER_NAMES.work}/out\`); do NOT \`cd\` into the skill folder to run it, or \`${CHAT_FOLDER_NAMES.attachments}/\` and \`${CHAT_FOLDER_NAMES.work}/\` won't be where your relative paths point.`,
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

    const customizeHint = `Copy it into \`${WORKSPACE_SKILLS_MOUNT}/\` to change it.`;
    const originSection =
      output.origin === "workspace"
        ? `\n\nThis skill lives at \`${WORKSPACE_SKILLS_MOUNT}/${output.skillName}\`; edit it there to change the skill for future tasks (the \`${CHAT_FOLDER_NAMES.work}/\` copy is only for this task).`
        : output.origin === "in-repo"
          ? `\n\nThis skill lives in this project at \`.agents/skills/${output.skillName}\`, outside the writable \`${WORKSPACE_SKILLS_MOUNT}/\` mount, so you cannot edit it in place from here. ${customizeHint}`
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
              : "install its locked dependencies into the task's `.venv`";
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
              `\`${PNPM_COMMAND.name} install\` was run for this task.`,
              `The skill's Node.js dependencies are ready to use.`,
              `Do not run \`${PNPM_COMMAND.name} add\` for packages this skill already provides.`,
            ].join(" ")
          : [
              `The skill's locked Python dependencies were installed in the task's \`.venv\`.`,
              `Run its Python scripts with \`python\`; do not install packages the skill already provides.`,
              `Those are its required dependencies only: a package its instructions say to \`pip install\` for one use is not installed until you install it.`,
            ].join(" ");
      });
      installSection = `\n\n${installText.join("\n\n")}`;
    }

    // The body is the only part of this the skill wrote, so it comes last:
    // where the copy landed, what was installed, and what we refused to
    // install all come before it, where nothing in the skill can appear to
    // have written them.
    const notes = (
      originSection +
      reloadSection +
      fileSection +
      installSection +
      contentSection
    ).trimStart();
    return {
      type: "text",
      value: `${notes}\n\n${skillInstructions({
        content: output.content,
        name: output.name,
      })}`,
    };
  },
});

/**
 * A skill's body, led by one line saying whose words follow. Shared by every
 * path that hands a skill's instructions to the model, so a skill reads the
 * same however it arrived. Callers put it last in their output, so everything
 * after the lead line is the skill's.
 */
export function skillInstructions({
  content,
  name,
}: {
  content: string;
  name: string;
}) {
  return `Everything below is the text of the skill "${name}".\n\n${content}`;
}
