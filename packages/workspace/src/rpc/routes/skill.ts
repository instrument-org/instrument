import { z } from "zod";

import {
  findSkill,
  findSkills,
  getSkillSources,
  listSkillFiles,
} from "../../lib/skills";
import { base } from "../base";

const SkillSourceSchema = z.enum([
  "agents",
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "registry",
  "system",
  "workspace",
]);

const SkillSummarySchema = z.object({
  description: z.string(),
  modelInvocable: z.boolean(),
  name: z.string(),
  path: z.string(),
  source: SkillSourceSchema,
});

const SkillDetailSchema = SkillSummarySchema.extend({
  content: z.string(),
  files: z.array(z.string()),
  filesTruncated: z.boolean(),
});

const list = base
  .output(SkillSummarySchema.array())
  .handler(async ({ context }) => {
    const skills = await findSkills(getSkillSources(context.workspaceConfig));
    return skills.map((skill) => ({
      description: skill.description,
      modelInvocable: skill.modelInvocable,
      name: skill.name,
      path: skill.skillDir,
      source: skill.source,
    }));
  });

const byName = base
  .input(z.object({ name: z.string() }))
  .output(SkillDetailSchema)
  .handler(async ({ context, errors, input }) => {
    const { skill } = await findSkill(context.workspaceConfig, input.name);
    if (!skill) {
      throw errors.NOT_FOUND({
        message: `Skill "${input.name}" was not found.`,
      });
    }

    const { files, truncated } = await listSkillFiles(
      skill.skillDir,
      AbortSignal.timeout(10_000),
    );
    return {
      content: skill.content,
      description: skill.description,
      files,
      filesTruncated: truncated,
      modelInvocable: skill.modelInvocable,
      name: skill.name,
      path: skill.skillDir,
      source: skill.source,
    };
  });

export const skill = { byName, list };
