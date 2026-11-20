import { APP_NAME_SLUG } from "@instrument-org/shared";
import { z } from "zod";

import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import {
  AGENT_BROWSER_GUIDE_NAME,
  agentBrowserGuide,
} from "../model-text/guides/agent-browser-guide";
import { ChatReads } from "./chat-reads";
import { modelWindow } from "./model-window";
import { SKILL_ORIGINS } from "./skill-provenance";
import { truncateSkillContent } from "./skills";
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
   * Only a pointer to the guide, which the session was handed whole before
   * the window its model is sent now; `content` is empty.
   */
  earlier: z.literal(true).optional(),
  name: z.string(),
  origin: z.enum(SKILL_ORIGINS),
});

export type BrowserSkill = z.output<typeof BrowserSkillSchema>;

/**
 * The instructions to attach to a bash result that ran `agent-browser`, or
 * nothing when the model can already see them.
 *
 * Whole once per session: the first browser command brings the guide. A
 * context rollover drops every assistant turn before its boundary, the
 * delivery with them (`modelWindow`), and the next browser command then
 * brings only a pointer to it (`earlier`): sent whole after every rollover,
 * the guide takes a fixed slice of each fresh window, and a long browser job
 * rolls over many times. The rollover's summary says how the work was going,
 * and `load_skill` shows the guide again when the model needs it. Best effort
 * throughout, since a missing attachment costs a `load_skill` call and a
 * failed bash result costs the command.
 */
export async function browserSkillToDeliver({
  sessionId,
  chatId,
  model,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
  /** The canonical id of the model the call answers to. */
  model: string | undefined;
}): Promise<BrowserSkill | undefined> {
  try {
    const [history, session] = await Promise.all([
      ChatReads.history({ chatId, sessionId }),
      ChatReads.session({ chatId, sessionId }),
    ]);
    if (history.isErr()) {
      return undefined;
    }
    const messages = history.value.filter(
      (message) => message.role !== "session-context",
    );
    const window = modelWindow({
      messages,
      model,
      session: session.isOk() ? session.value : undefined,
    }).messages;
    if (window.some((message) => carries(message, () => true))) {
      return undefined;
    }
    return messages.some((message) =>
      carries(message, (skill) => skill.earlier !== true),
    )
      ? earlierBrowserSkill()
      : loadBrowserSkill();
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}

/**
 * Whether a message carries the instructions, from a delivery `counts`
 * accepts or from the model loading the skill itself.
 */
function carries(
  message: SessionMessage.WithParts,
  counts: (skill: BrowserSkill) => boolean,
): boolean {
  return message.parts.some((part) => {
    if (part.type === "tool-bash" && part.state === "output-available") {
      return (
        part.output.browserSkill !== undefined &&
        counts(part.output.browserSkill)
      );
    }
    if (part.type === "tool-load_skill" && part.state === "output-available") {
      return (
        part.output.state === "success" &&
        part.output.skillName === AGENT_BROWSER_GUIDE_NAME &&
        part.output.origin === APP_NAME_SLUG
      );
    }
    return false;
  });
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

/** A pointer to the guide the session was handed before its window. */
function earlierBrowserSkill(): BrowserSkill {
  return {
    content: "",
    contentTruncated: false,
    earlier: true,
    name: AGENT_BROWSER_GUIDE_NAME,
    origin: APP_NAME_SLUG,
  };
}
