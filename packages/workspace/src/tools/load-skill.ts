import { APP_NAME } from "@instrument-org/shared";
import nodeIgnore from "ignore";
import ms from "ms";
import { ok } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import { FOLDER_VARIABLES } from "../constants";
import { executeError } from "../lib/execute-error";
import { rememberLoadedSkill } from "../lib/loaded-skill";
import { preparedBundledSkill } from "../lib/prepare-bundled-skills";
import { NODE_COMMAND } from "../lib/shell-commands/node";
import { PNPM_COMMAND } from "../lib/shell-commands/pnpm";
import { PYTHON_COMMAND } from "../lib/shell-commands/python";
import { SKILL_COPY_IGNORE } from "../lib/skill-artifact-ignore";
import { renderSkillCatalog } from "../lib/skill-catalog";
import {
  ensureNodeEnvironment,
  ensurePythonEnvironment,
} from "../lib/skill-environments";
import {
  getSkillProvenance,
  getWritableSkillsRoot,
  SKILL_ORIGINS,
} from "../lib/skill-provenance";
import { getSkillRuntime } from "../lib/skill-runtime";
import {
  BUNDLED_SOURCE_IDS,
  FILE_LIST_LIMIT,
  findSkills,
  getSkillSources,
  listSkillFiles,
  resolveSkillName,
  SKILL_CONTENT_LIMIT,
  type SkillInfo,
  truncateSkillContent,
} from "../lib/skills";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { shellPath } from "../lib/workspace-fs-layout";
import { type ChatId } from "../schemas/chat-id";
import { type AbsolutePath } from "../schemas/paths";
import { defineCapability } from "../lib/capabilities/define";
import { modelTool } from "../lib/capabilities/tool";

/** A skill's files that a task never reads or runs. */
const SKILL_DEVELOPMENT_FILES = nodeIgnore().add(SKILL_COPY_IGNORE);

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

const loadSkillCapability = defineCapability({
  input: z.object({
    name: z.string().meta({
      description: "The name of the skill to load.",
    }),
  }),
  name: "skills.load",
  summary: "Loads a skill by its name.",
  surfaces: {
    tool: {
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

    Note: a skill is read where it is, and the dependencies it declares are set up the first time it is loaded.
  `.trim(),
      execute: async ({ input, sessionId, signal, chatId }) => {
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

        const runtime = await getSkillRuntime(skill.skillDir, skill.name);
        if ("error" in runtime) {
          return executeError(runtime.error);
        }

        const { installResults, origin, skillDir } = await setUpSkill({
          chatId,
          runtime,
          signal,
          skill,
        });
        const { files: skillFiles, truncated } = await listSkillFiles(
          skillDir,
          signal,
        );
        rememberLoadedSkill(sessionId, skillDir);

        const body = truncateSkillContent(skill.content);

        return ok({
          content: body.content,
          contentTruncated: body.truncated,
          // SKILL.md is already inlined above as the skill's content, so listing
          // it again would just spend context restating what the agent is reading.
          // What only the skill's own development uses (its template, its tests)
          // is no part of what the agent reads or runs.
          files: skillFiles.filter(
            (f) => f !== "SKILL.md" && !SKILL_DEVELOPMENT_FILES.ignores(f),
          ),
          ...(installResults.length > 0 ? { installResults } : {}),
          name: skill.id,
          origin,
          skillDir,
          skillFolder: shellPath(skillDir),
          skillName: skill.name,
          state: "success" as const,
          truncated,
        });
      },
      readOnly: false,
      // A deadline, not a delay: dependency-free skills still return immediately.
      // Keeping the maximum removes a second, synchronous skill resolver that can
      // drift from execution and under-budget an alias or stable ID.
      timeoutMs: () => ms("7 minutes") + ms("10 seconds"),
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

        const skill = `$${FOLDER_VARIABLES.skill}`;
        const skillPath = output.skillFolder ?? shellPath(output.skillDir);
        const locationSection = `This skill's folder is \`${skillPath}\`, which the shell names \`${skill}\` until you load another skill.`;

        const contentSection = output.contentTruncated
          ? `\n\nThis skill's SKILL.md is longer than ${SKILL_CONTENT_LIMIT} characters, so only its beginning is below. Read \`${skill}/SKILL.md\` for the rest before following it.`
          : "";

        let fileSection = "";
        if (output.files.length > 0) {
          const fileSectionText = [
            `For an operation a script already covers, read it and run it with \`${NODE_COMMAND.name}\` (TypeScript) or \`${PYTHON_COMMAND.name}\` (Python) rather than rewriting it.`,
            `Run a script where it is, by its full path from your work folder (e.g. \`${NODE_COMMAND.name} "${skill}/scripts/<script>.ts" <input> --output <job>/out\` or \`${PYTHON_COMMAND.name} "${skill}/scripts/<script>.py" <input> --output <job>/out\`); do NOT \`cd\` into the skill's folder, or your relative paths won't point into your work folder.`,
            `For work the scripts don't cover -- especially content, layout, or anything generative -- write your own code against the skill's libraries (see its recipes) in your work folder instead of bending a script's flags to fit.`,
          ].join(" ");

          const fileListXml = [
            `<${TAGS.skillFiles}>`,
            ...output.files.map((f) => `<${TAGS.file}>${f}</${TAGS.file}>`),
            `</${TAGS.skillFiles}>`,
          ].join("\n");

          const truncationNote = output.truncated
            ? `\nNote: file list truncated at ${FILE_LIST_LIMIT} entries.`
            : "";

          fileSection = `\n\n${fileSectionText} Its files, in its folder:\n\n${fileListXml}${truncationNote}`;
        }

        // By its variable, which the session's system information says where it
        // points, so a stored result reads the same after the workspace moves.
        const workspaceSkillsPath = `$${FOLDER_VARIABLES.workspaceSkills}`;
        const customizeHint = `Copy it into \`${workspaceSkillsPath}/\` to change it.`;
        const builtCopy = output.installResults?.some(
          (result) => result.runtime === "node" && result.state === "success",
        );
        const originSection =
          output.origin === "workspace"
            ? builtCopy
              ? `\n\nThis is the workspace's own skill, at \`${workspaceSkillsPath}/${output.skillName}\`: edit it there to change the skill for future tasks. Its scripts run from a copy beside its Node.js packages, which takes your edits when the skill is loaded again.`
              : `\n\nThis is the workspace's own skill: edit it in its folder to change the skill for future tasks.`
            : output.origin === "in-repo"
              ? `\n\nThis skill lives in this project at \`.agents/skills/${output.skillName}\`, outside the workspace's skills folder (\`${workspaceSkillsPath}/\`), so you cannot edit it in place from here. ${customizeHint}`
              : output.origin === "instrument"
                ? `\n\nThis skill is provided by ${APP_NAME} and is read-only. ${customizeHint}`
                : `\n\nThis skill comes from a skills folder elsewhere on this machine and is read-only. ${customizeHint}`;

        let installSection = "";
        if (output.installResults) {
          const installText = output.installResults.map((installResult) => {
            const runtimeName =
              installResult.runtime === "node" ? "Node.js" : "Python";
            if (installResult.state === "skipped") {
              const installHint =
                installResult.runtime === "node"
                  ? `run \`${PNPM_COMMAND.name} install\` there`
                  : `install the packages its \`pyproject.toml\` lists with \`pip install\``;
              return [
                `This skill declares ${runtimeName} dependencies, but ${APP_NAME} did not set them up because the skill comes from a third-party skills folder on this machine.`,
                `Review the skill first; if you trust it, copy it into a folder in your work folder, ${installHint}, and run the copy's scripts.`,
              ].join(" ");
            }

            if (installResult.state === "failure") {
              return [
                `Setting up the skill's ${runtimeName} packages failed (exit ${installResult.exitCode}), so its scripts may not run.`,
                `Raw output:\n\`\`\`\n${installResult.output}\n\`\`\``,
              ].join(" ");
            }

            return installResult.runtime === "node"
              ? [
                  `Its Node.js packages are installed beside its scripts.`,
                  `Its folder is read-only, so a script of your own goes in your work folder, with what it imports added there (\`${PNPM_COMMAND.name} add <package>\`).`,
                ].join(" ")
              : [
                  `Its Python packages are installed: \`${PYTHON_COMMAND.name}\` runs its scripts with them, and your own scripts too until you load another skill, so do not install them again.`,
                  `A package its instructions say to \`pip install\` for one use is not among them; installing it puts it in a \`.venv\` in your work folder, where its scripts find it as well as yours.`,
                ].join(" ");
          });
          installSection = `\n\n${installText.join("\n\n")}`;
        }

        // The body is the only part of this the skill wrote, so it comes last:
        // where the skill is, what was set up, and what we refused to set up
        // all come before it, where nothing in the skill can appear to have
        // written them.
        const notes =
          locationSection +
          originSection +
          fileSection +
          installSection +
          contentSection;
        return {
          type: "text",
          value: `${notes}\n\n${skillInstructions({
            content: output.content,
            name: output.name,
          })}`,
        };
      },
      name: "load_skill",
      output: z.discriminatedUnion("state", [
        z.object({
          content: z.string(),
          // True when the body was longer than `SKILL_CONTENT_LIMIT` and only its
          // head was inlined, so the model is told where to read the rest.
          contentTruncated: z.boolean(),
          // The skill's files, relative to `skillDir`.
          files: z.array(z.string()),
          installResults: z.array(SkillInstallResultSchema).optional(),
          name: z.string(),
          // Where the skill came from, so the model can say so and knows whether it
          // can edit the skill in place: "workspace" lives in the writable
          // workspace skills folder, the others are read-only where they were discovered.
          origin: z.enum(SKILL_ORIGINS),
          // The folder the skill is read and its scripts run from, on the host,
          // which the shell names `INSTRUMENT_SKILL_DIR` (`lastLoadedSkillDir`):
          // the skill's own, a skill the app ships in the runtime folder, or a
          // Node skill's built copy beside its packages.
          skillDir: z.string(),
          /** `skillDir` as the agent's shell spelled it when loaded, which the model is told. */
          skillFolder: z.string().optional(),
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
    },
  },
});

export const LoadSkill = modelTool(loadSkillCapability);

/**
 * Where a skill is read and its scripts run from, with its dependencies set
 * up: a skill the app ships from the runtime folder, since its own folder is
 * in the signed bundle; a Node skill from its built copy beside its
 * packages, where Node finds them; every other one where it is. Its Python
 * dependencies go in its environment, which `python` picks for its scripts.
 *
 * Third-party skills discovered in another tool's folder on this machine get
 * no dependencies set up: they are code we'd fetch and run before anyone has
 * vetted the skill. What the app ships and the workspace's own are trusted
 * enough to set up on load.
 */
export async function setUpSkill({
  chatId,
  runtime,
  signal,
  skill,
}: {
  chatId: ChatId;
  runtime: { node: boolean; python: boolean };
  signal?: AbortSignal;
  skill: SkillInfo;
}): Promise<{
  installResults: z.output<typeof SkillInstallResultSchema>[];
  origin: (typeof SKILL_ORIGINS)[number];
  skillDir: AbsolutePath;
}> {
  const workspaceConfig = getWorkspaceConfig();
  const provenance = getSkillProvenance(
    skill,
    await getWritableSkillsRoot(workspaceConfig.rootDir),
  );
  const folder =
    (BUNDLED_SOURCE_IDS.has(skill.sourceId)
      ? await preparedBundledSkill(workspaceConfig, skill.name)
      : undefined) ?? skill.skillDir;

  const installResults: z.output<typeof SkillInstallResultSchema>[] = [];
  let skillDir = folder;

  if (runtime.node) {
    if (provenance.installDependencies) {
      const built = await ensureNodeEnvironment({
        chatId,
        signal,
        skillDir: folder,
      });
      if ("dir" in built) {
        skillDir = built.dir;
        installResults.push({ runtime: "node", state: "success" });
      } else {
        installResults.push({
          ...built.error,
          runtime: "node",
          state: "failure",
        });
      }
    } else {
      installResults.push({ runtime: "node", state: "skipped" });
    }
  }

  if (runtime.python) {
    if (provenance.installDependencies) {
      const built = await ensurePythonEnvironment({
        chatId,
        signal,
        skillDir: folder,
      });
      installResults.push(
        "venv" in built
          ? { runtime: "python", state: "success" }
          : { ...built.error, runtime: "python", state: "failure" },
      );
    } else {
      installResults.push({ runtime: "python", state: "skipped" });
    }
  }

  return { installResults, origin: provenance.origin, skillDir };
}

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
