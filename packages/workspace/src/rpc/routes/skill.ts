import { eventIterator } from "@orpc/server";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { REGISTRY_FOLDER_NAMES } from "../../constants";
import { absolutePathJoin } from "../../lib/absolute-path-join";
import { deleteSkill } from "../../lib/delete-skill";
import { pathIsWithin } from "../../lib/path-is-within";
import {
  findSkill,
  findSkills,
  getSkillSources,
  listSkillFiles,
  SKILL_SOURCE_KINDS,
  splitFrontmatter,
} from "../../lib/skills";
import { type AbsolutePath } from "../../schemas/paths";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

/**
 * Past this a file stops being something to read on a skill page, and the cost
 * of pushing it through RPC and a highlighter starts to show.
 */
const FILE_SIZE_LIMIT = 512 * 1024;

const SkillSourceSchema = z.enum(SKILL_SOURCE_KINDS);

const SkillSummarySchema = z.object({
  aliases: z.string().array(),
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
  id: z.string(),
  modelInvocable: z.boolean(),
  name: z.string(),
  path: z.string(),
  /**
   * Compatibility alias for manually typed invocations. Persisted routes and
   * mentions use `id`, whose value does not depend on installed namesakes.
   */
  qualifiedName: z.string(),
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
      aliases: skill.aliases,
      description: skill.description,
      editable: isEditable(skill.skillDir, writableRoot),
      fileCount: listings[index]?.files.length ?? 0,
      filesTruncated: listings[index]?.truncated ?? false,
      id: skill.id,
      modelInvocable: skill.modelInvocable,
      name: skill.name,
      path: skill.skillDir,
      qualifiedName: skill.qualifiedName,
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
      aliases: skill.aliases,
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
      id: skill.id,
      modelInvocable: skill.modelInvocable,
      name: skill.name,
      path: skill.skillDir,
      qualifiedName: skill.qualifiedName,
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
    if (!pathIsWithin(filePath, skill.skillDir)) {
      throw errors.NOT_FOUND({
        message: `"${input.path}" is not part of the "${input.name}" skill.`,
      });
    }

    const stats = await fs.lstat(filePath).catch(() => null);
    if (!stats) {
      throw errors.NOT_FOUND({ message: `"${input.path}" was not found.` });
    }

    const canonicalFilePath = stats.isSymbolicLink()
      ? await fs.realpath(filePath).catch(() => null)
      : filePath;
    if (
      canonicalFilePath === null ||
      !pathIsWithin(canonicalFilePath, skill.skillDir)
    ) {
      throw errors.NOT_FOUND({
        message: `"${input.path}" is not part of the "${input.name}" skill.`,
      });
    }

    const fileStats = await fs.stat(canonicalFilePath).catch(() => null);
    if (!fileStats?.isFile()) {
      throw errors.NOT_FOUND({ message: `"${input.path}" was not found.` });
    }
    if (fileStats.size > FILE_SIZE_LIMIT) {
      return { kind: "too-large" } as const;
    }

    const bytes = await fs.readFile(canonicalFilePath);
    // A NUL byte is what separates something worth showing as text from an
    // image or a compiled artifact the skill happens to ship.
    if (bytes.includes(0)) {
      return { kind: "binary" } as const;
    }

    return { content: bytes.toString("utf8"), kind: "text" } as const;
  });

const remove = base
  .input(z.object({ name: z.string() }))
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const result = await deleteSkill(context.workspaceConfig, input.name);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    publisher.publish("skill.changed", null);
  });

/**
 * Fires whenever the workspace skills directory changes. Deliberately a bare
 * signal rather than a live `list`: the surfaces that show skills each hold
 * their own cached `list`, and a stream that re-walked every source per
 * subscriber would trade the caching those surfaces were given for freshness
 * they can get by invalidating once on this.
 *
 * `revision` counts events on this subscription. It carries no meaning beyond
 * making one event distinguishable from the next, which a client that reacts to
 * a cached value needs before it can act on the second change.
 *
 * Revision 0 is emitted as soon as the subscription is live, before any change.
 * A live query whose stream ends without ever yielding is an error to the client
 * runtime, which then retries and eventually gives up -- so a stream that only
 * spoke when something changed would go quiet for good after the first
 * disconnect. It also gives the client a resync point: events published while
 * nothing was subscribed are gone, so a fresh subscription is exactly when a
 * consumer wants to re-read.
 */
const changed = base
  .output(eventIterator(z.object({ revision: z.number() })))
  .handler(async function* ({ signal }) {
    const changes = publisher.subscribe("skill.changed", { signal });
    let revision = 0;
    yield { revision };
    for await (const _ of changes) {
      revision += 1;
      yield { revision };
    }
  });

export const skill = { byName, file, list, live: { changed }, remove };
