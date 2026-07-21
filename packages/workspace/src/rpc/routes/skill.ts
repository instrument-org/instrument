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
  fileCount: z.number(),
  filesTruncated: z.boolean(),
  modelInvocable: z.boolean(),
  name: z.string(),
  path: z.string(),
  source: SkillSourceSchema,
  title: z.string(),
});

const SkillDetailSchema = SkillSummarySchema.extend({
  content: z.string(),
  files: z.array(z.string()),
});

const list = base
  .output(SkillSummarySchema.array())
  .handler(async ({ context }) => {
    const skills = await findSkills(getSkillSources(context.workspaceConfig));
    // Counting means walking every skill. Measured at a few milliseconds for a
    // few dozen skills, because the walk skips dependency trees and stops at
    // FILE_LIST_LIMIT, so it stays bounded however large a skill is.
    const signal = AbortSignal.timeout(10_000);
    const listings = await Promise.all(
      skills.map((skill) => listSkillFiles(skill.skillDir, signal)),
    );

    return skills.map((skill, index) => ({
      description: skill.description,
      fileCount: listings[index]?.files.length ?? 0,
      filesTruncated: listings[index]?.truncated ?? false,
      modelInvocable: skill.modelInvocable,
      name: skill.name,
      path: skill.skillDir,
      source: skill.source,
      title: skill.title,
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
      fileCount: files.length,
      files,
      filesTruncated: truncated,
      modelInvocable: skill.modelInvocable,
      name: skill.name,
      path: skill.skillDir,
      source: skill.source,
      title: skill.title,
    };
  });

export const skill = { byName, list };
