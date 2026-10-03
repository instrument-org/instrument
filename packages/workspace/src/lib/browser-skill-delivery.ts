import { APP_NAME_SLUG } from "@instrument-org/shared";
import { z } from "zod";

import { MOUNT } from "../mount-points";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { applyContextRollover } from "./apply-context-rollover";
import { normalizedPathJoin } from "./normalize-path";
import { SKILL_NAMES } from "./skill-names";
import {
  getSkillProvenance,
  getWritableSkillsRoot,
  SKILL_ORIGINS,
} from "./skill-provenance";
import {
  findSkills,
  getSkillSources,
  skillsMountSegment,
  truncateSkillContent,
} from "./skills";
import { Store } from "./store";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The `agent-browser` skill's instructions as the bash tool hands them over
 * with a command's output, so a session that reaches for the browser gets them
 * without spending a model step on `load_skill` first.
 */
export const BrowserSkillSchema = z.object({
  content: z.string(),
  /** Whether `content` is only the head of a body over the skill size limit. */
  contentTruncated: z.boolean(),
  /**
   * Where the skill sits in the read-only skills mount. Its body links its
   * references by relative path, and this is what they are relative to.
   */
  directory: z.string(),
  name: z.string(),
  origin: z.enum(SKILL_ORIGINS),
});

export type BrowserSkill = z.output<typeof BrowserSkillSchema>;

/**
 * The instructions to attach to a bash result that ran `agent-browser`, or
 * nothing when the model can already see them.
 *
 * Read against the history the model is actually sent: a context rollover
 * drops every assistant turn before its boundary, the earlier delivery or
 * `load_skill` call with them, so the next browser command brings the
 * instructions back. A new session starts with none and gets them the same
 * way. Best effort throughout, since a missing attachment costs a `load_skill`
 * call and a failed bash result costs the command.
 */
export async function browserSkillToDeliver({
  sessionId,
  signal,
  taskId,
}: {
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
}): Promise<BrowserSkill | undefined> {
  try {
    const [messages, session] = await Promise.all([
      Store.getMessagesWithParts({ sessionId, taskId }, { signal }),
      Store.getSession(sessionId, taskId, { signal }),
    ]);
    if (messages.isErr()) {
      return undefined;
    }
    const window = applyContextRollover({
      messages: messages.value,
      rolledOverAfterMessageId: session.isOk()
        ? session.value.rolledOverAfterMessageId
        : undefined,
    });
    if (browserSkillInWindow(window)) {
      return undefined;
    }
    return await loadBrowserSkill();
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}

/**
 * Whether any message the model is sent already carries the instructions,
 * from an earlier delivery or from the model loading the skill itself.
 */
function browserSkillInWindow(
  messages: readonly SessionMessage.WithParts[],
): boolean {
  return messages.some((message) =>
    message.parts.some((part) => {
      if (part.type === "tool-bash" && part.state === "output-available") {
        return part.output.browserSkill !== undefined;
      }
      if (
        part.type === "tool-load_skill" &&
        part.state === "output-available"
      ) {
        return (
          part.output.state === "success" &&
          part.output.skillName === SKILL_NAMES.agentBrowser &&
          part.output.origin === APP_NAME_SLUG
        );
      }
      return false;
    }),
  );
}

/**
 * The app's own copy, never a namesake: a machine with upstream's skill
 * installed in another agent's home has two skills answering to the name, and
 * only ours describes this wrapper.
 */
async function loadBrowserSkill(): Promise<BrowserSkill | undefined> {
  const workspaceConfig = getWorkspaceConfig();
  const writableRoot = await getWritableSkillsRoot(workspaceConfig.rootDir);
  const skill = (await findSkills(getSkillSources(workspaceConfig))).find(
    (candidate) =>
      candidate.name === SKILL_NAMES.agentBrowser &&
      getSkillProvenance(candidate, writableRoot).origin === APP_NAME_SLUG,
  );
  if (!skill) {
    return undefined;
  }
  const body = truncateSkillContent(skill.content);
  return {
    content: body.content,
    contentTruncated: body.truncated,
    directory: normalizedPathJoin(
      MOUNT.skills,
      skillsMountSegment(skill.sourceId),
      skill.name,
    ),
    name: skill.id,
    origin: APP_NAME_SLUG,
  };
}
