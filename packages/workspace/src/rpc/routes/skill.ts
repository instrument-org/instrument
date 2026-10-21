import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { listFolder } from "../../lib/chat/folder-look";
import { deleteSkill } from "../../lib/delete-skill";
import {
  setSkillFolderLoaded,
  skippedSkillFolders,
} from "../../lib/guarded-skill-folders";
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

/**
 * The skills folders the last pass left unread because they really are in a
 * place macOS guards (a `~/.claude/skills` linked into Documents), which the
 * person loads in Settings rather than meeting the system's prompt unasked.
 * Read after a `list`, which is the pass that finds them.
 */
const skippedFolders = base
  .output(z.object({ folder: z.string(), root: z.string() }).array())
  .handler(async ({ context }) => {
    await findSkills(getSkillSources(context.workspaceConfig));
    return skippedSkillFolders();
  });

/**
 * Loads a skills folder the passes skip: looks inside it as the app, which
 * is when macOS asks the person about it, beside the button they pressed,
 * and waits for their answer. Let in, it is recorded so every later pass
 * reads it; refused, it stays skipped.
 */
const loadFolder = base
  .input(z.object({ folder: z.string() }))
  .output(z.object({ loaded: z.boolean() }))
  .handler(async ({ input }) => {
    const known = skippedSkillFolders().some(
      (skipped) => skipped.folder === input.folder,
    );
    if (!known) {
      return { loaded: false };
    }
    const looked = await listFolder(input.folder);
    if (looked !== "open") {
      return { loaded: false };
    }
    await setSkillFolderLoaded(input.folder, true);
    publisher.publish("skill.changed", null);
    return { loaded: true };
  });

export const skill = {
  events: { changed },
  list,
  loadFolder,
  remove,
  skippedFolders,
};
