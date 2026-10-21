import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { deleteSkill } from "../../lib/delete-skill";
import {
  getSkillProvenance,
  getWritableSkillsRoot,
} from "../../lib/skill-provenance";
import {
  findSkills,
  getSkillSources,
  listSkillFiles,
  SKILL_SOURCE_KINDS,
} from "../../lib/skills";
import { startWatchingWorkspaceSkills } from "../../lib/workspace-skill-watcher";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

const SkillSourceSchema = z.enum(SKILL_SOURCE_KINDS);

const SkillSummarySchema = z.object({
  aliases: z.string().array(),
  description: z.string(),
  /**
   * True when the skill lives in the one workspace directory the agent can
   * write to: the skills the person installed or made, which the UI offers
   * to delete. The other workspace source (`.agents/skills`) is listed but
   * sits outside the writable skills directory.
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

const list = base
  .output(SkillSummarySchema.array())
  .handler(async ({ context }) => {
    const skills = await findSkills(getSkillSources(context.workspaceConfig));
    const writableRoot = await getWritableSkillsRoot(
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
      editable: getSkillProvenance(skill, writableRoot).editable,
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

const remove = base
  .input(z.object({ name: z.string() }))
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const result = await deleteSkill(context.workspaceConfig, input.name);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
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
    const stopWatching = await startWatchingWorkspaceSkills();
    let revision = 0;
    try {
      yield { revision };
      for await (const _ of changes) {
        revision += 1;
        yield { revision };
      }
    } finally {
      await stopWatching();
    }
  });

export const skill = { events: { changed }, list, remove };
