import { dedent, sift } from "radashi";

import { contextDateKey, formatContextDate } from "../lib/context-date";
import { getCurrentDate } from "../lib/get-current-date";
import { getSystemInfo } from "../lib/get-system-info";
import { isToolPart } from "../lib/is-tool-part";
import { getWorkspaceConfig } from "../lib/workspace-config";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type AgentName } from "./types";

export function createContextMessage({
  agentName,
  now,
  sessionId,
  textParts,
}: {
  agentName: AgentName;
  now: Date;
  sessionId: StoreId.Session;
  textParts: (boolean | null | string | undefined)[];
}): SessionMessage.ContextWithParts {
  const userMessageId = StoreId.newMessageId();

  const text = sift(
    textParts.map((part) =>
      typeof part === "string" ? part.trim() : undefined,
    ),
  ).join("\n\n");

  return {
    id: userMessageId,
    metadata: {
      agentName,
      createdAt: now,
      realRole: "user",
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt: now,
          endedAt: now,
          id: StoreId.newPartId(),
          messageId: userMessageId,
          sessionId,
        },
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "session-context",
  };
}

export function createSystemMessage({
  agentName,
  now,
  sessionId,
  text,
}: {
  agentName: AgentName;
  now: Date;
  sessionId: StoreId.Session;
  text: string;
}): SessionMessage.ContextWithParts {
  const systemMessageId = StoreId.newMessageId();

  return {
    id: systemMessageId,
    metadata: {
      agentName,
      createdAt: now,
      realRole: "system",
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt: now,
          endedAt: now,
          id: StoreId.newPartId(),
          messageId: systemMessageId,
          sessionId,
        },
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "session-context",
  };
}

/**
 * `network` names what reaches the network, for an agent whose shell and
 * tools have any; the chat's have none.
 */
export function getSystemInfoText({ network }: { network?: string } = {}) {
  const now = getCurrentDate();
  return dedent`
    <system_info>
    The user's computer: ${getSystemInfo()}. You run on it: their files and apps belong to this system, and so does anything you write for them to run.
    Your shell: an emulated POSIX shell with GNU coreutils spellings, whatever the user's computer is. Reach for \`stat -c\`, \`date -d\`, and \`sed -i\` with no backup suffix; the BSD forms (\`stat -f\`, \`date -r\`, \`sed -i ''\`) do not exist here.${network === undefined ? "" : ` ${network}`}
    Current date: ${formatContextDate(contextDateKey(now))} -- the day this session started. A session that runs past midnight is told the new date on the turn it happens; until then, this is today.
    Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}, the computer's and so a fair guide to where the user is. This session started at ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} local time; \`date\` in your shell gives the time now.
    </system_info>
  `.trim();
}

/**
 * Who the agent is working for, when someone is signed in: their name when
 * the account gives one, so a reply can address them and a service reached
 * under their account is read as theirs, and the email that account goes by. Nothing while signed out,
 * and nothing when the account cannot be read, since a guessed name is worse
 * than none. A startup snapshot like the rest of the context, so a session
 * opened before a sign-in never learns the name.
 */
export async function getUserText(): Promise<string | undefined> {
  const user = await getWorkspaceConfig().getUser?.();
  if (!user) {
    return undefined;
  }
  return user.name
    ? `The user's name is ${user.name}, signed in as ${user.email}.`
    : `The user is signed in as ${user.email}.`;
}

export function shouldContinueWithToolCalls({
  messages,
}: {
  messages: SessionMessage.WithParts[];
}) {
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  // Continue if no assistant message was found
  if (!lastAssistantMessage) {
    return Promise.resolve(true);
  }

  // Continue if last assistant message has tool calls
  return Promise.resolve(
    lastAssistantMessage.parts.some((part) => isToolPart(part)),
  );
}
