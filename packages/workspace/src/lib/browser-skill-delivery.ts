import { APP_NAME_SLUG } from "@instrument-org/shared";
import { z } from "zod";

import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import {
  AGENT_BROWSER_GUIDE_NAME,
  agentBrowserGuide,
} from "./agent-browser-guide";
import { applyContextRollover } from "./apply-context-rollover";
import { SKILL_ORIGINS } from "./skill-provenance";
import { truncateSkillContent } from "./skills";
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
    return loadBrowserSkill();
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
          part.output.skillName === AGENT_BROWSER_GUIDE_NAME &&
          part.output.origin === APP_NAME_SLUG
        );
      }
      return false;
    }),
  );
}

/** The guide as the installed CLI ships it, led by what differs here (`agent-browser-guide.ts`). */
function loadBrowserSkill(): BrowserSkill {
  const body = truncateSkillContent(agentBrowserGuide());
  return {
    content: body.content,
    contentTruncated: body.truncated,
    name: AGENT_BROWSER_GUIDE_NAME,
    origin: APP_NAME_SLUG,
  };
}
