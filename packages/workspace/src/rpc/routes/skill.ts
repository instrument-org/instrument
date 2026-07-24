import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { REGISTRY_FOLDER_NAMES } from "../../constants";
import { absolutePathJoin } from "../../lib/absolute-path-join";
import {
  findSkill,
  findSkills,
  getSkillSources,
  listSkillFiles,
  SKILL_SOURCE_KINDS,
  splitFrontmatter,
} from "../../lib/skills";
import { type AbsolutePath } from "../../schemas/paths";
import { base } from "../base";

/**
 * Past this a file stops being something to read on a skill page, and the cost
 * of pushing it through RPC and a highlighter starts to show.
 */
const FILE_SIZE_LIMIT = 512 * 1024;

const SkillSourceSchema = z.enum(SKILL_SOURCE_KINDS);

const SkillSummarySchema = z.object({
  description: z.string(),
  /**
   * True when the skill lives in the one workspace directory the agent can
   * write to, so the UI can offer an edit action that actually lands. The
   * other workspace source (`.agents/skills`) is listed but sits outside the
   * writable `/skills` mount, so pointing an edit agent at it would fork a
   * duplicate rather than revise it in place.
   */
  editable: z.boolean(),
  fileCount: z.number(),
  filesTruncated: z.boolean(),
  modelInvocable: z.boolean(),
  name: z.string(),
  path: z.string(),
  source: SkillSourceSchema,
  title: z.string(),
  userInvocable: z.boolean(),
});

const SkillDetailSchema = SkillSummarySchema.extend({
  compatibility: z.string().nullable(),
  content: z.string(),
  files: z.array(z.string()),
  frontmatter: z.string(),
  rawSkillFile: z.string(),
});

const SkillFileSchema = z.discriminatedUnion("kind", [
  z.object({ content: z.string(), kind: z.literal("text") }),
  z.object({ kind: z.literal("binary") }),
  z.object({ kind: z.literal("too-large") }),
]);

function isEditable(skillDir: string, writableRoot: string): boolean {
  return (
    skillDir === writableRoot || skillDir.startsWith(writableRoot + path.sep)
  );
}

/**
 * Canonical path of the one workspace skills directory the agent can write to
 * (the writable `/skills` mount). Editability is decided by containment here,
 * which matches agent writability exactly: a symlinked skill dir canonicalizes
 * outside this root and the mount blocks the escape anyway.
 */
async function writableSkillsRoot(rootDir: AbsolutePath): Promise<string> {
  const root = absolutePathJoin(rootDir, REGISTRY_FOLDER_NAMES.skills);
  return fs.realpath(root).catch(() => root);
}

const list = base
  .output(SkillSummarySchema.array())
  .handler(async ({ context }) => {
    const skills = await findSkills(getSkillSources(context.workspaceConfig));
    const writableRoot = await writableSkillsRoot(
      context.workspaceConfig.rootDir,
    );
    // Counting means walking every skill. Measured at a few milliseconds for a
    // few dozen skills, because the walk skips dependency trees and stops at
    // FILE_LIST_LIMIT, so it stays bounded however large a skill is.
    const signal = AbortSignal.timeout(10_000);
    const listings = await Promise.all(
      skills.map((skill) => listSkillFiles(skill.skillDir, signal)),
    );

    return skills.map((skill, index) => ({
      description: skill.description,
      editable: isEditable(skill.skillDir, writableRoot),
      fileCount: listings[index]?.files.length ?? 0,
      filesTruncated: listings[index]?.truncated ?? false,
      modelInvocable: skill.modelInvocable,
      name: skill.name,
      path: skill.skillDir,
      source: skill.source,
      title: skill.title,
      userInvocable: skill.userInvocable,
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
    const writableRoot = await writableSkillsRoot(
      context.workspaceConfig.rootDir,
    );
    const rawSkillFile = await fs.readFile(
      path.join(skill.skillDir, "SKILL.md"),
      "utf8",
    );
    const frontmatterResult = splitFrontmatter(rawSkillFile);
    return {
      compatibility: skill.compatibility ?? null,
      content: skill.content,
      description: skill.description,
      editable: isEditable(skill.skillDir, writableRoot),
      fileCount: files.length,
      files,
      filesTruncated: truncated,
      frontmatter: frontmatterResult.ok
        ? `---\n${frontmatterResult.block}\n---`
        : "",
      modelInvocable: skill.modelInvocable,
      name: skill.name,
      path: skill.skillDir,
      rawSkillFile,
      source: skill.source,
      title: skill.title,
      userInvocable: skill.userInvocable,
    };
  });

const file = base
  .input(z.object({ name: z.string(), path: z.string() }))
  .output(SkillFileSchema)
  .handler(async ({ context, errors, input }) => {
    const { skill } = await findSkill(context.workspaceConfig, input.name);
    if (!skill) {
      throw errors.NOT_FOUND({
        message: `Skill "${input.name}" was not found.`,
      });
    }

    // The caller picks from a list we produced, so containment is a guard
    // against a crafted path rather than an expected case.
    const filePath = path.resolve(skill.skillDir, input.path);
    if (!filePath.startsWith(skill.skillDir + path.sep)) {
      throw errors.NOT_FOUND({
        message: `"${input.path}" is not part of the "${input.name}" skill.`,
      });
    }

    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats?.isFile()) {
      throw errors.NOT_FOUND({ message: `"${input.path}" was not found.` });
    }
    if (stats.size > FILE_SIZE_LIMIT) {
      return { kind: "too-large" } as const;
    }

    const bytes = await fs.readFile(filePath);
    // A NUL byte is what separates something worth showing as text from an
    // image or a compiled artifact the skill happens to ship.
    if (bytes.includes(0)) {
      return { kind: "binary" } as const;
    }

    return { content: bytes.toString("utf8"), kind: "text" } as const;
  });

export const skill = { byName, file, list };
