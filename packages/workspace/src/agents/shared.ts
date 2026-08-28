import { dedent, sift } from "radashi";

import { contextDateKey, formatContextDate } from "../lib/context-date";
import { fileTree } from "../lib/file-tree";
import { getCurrentDate } from "../lib/get-current-date";
import { getSystemInfo } from "../lib/get-system-info";
import { isToolPart } from "../lib/is-tool-part";
import { type AbsolutePath } from "../schemas/paths";
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

export function getSystemInfoText() {
  const now = getCurrentDate();
  return dedent`
    <system_info>
    The user's computer: ${getSystemInfo()}. Their files and apps belong to this system, and so does anything you write for them to run. It is not where your own commands run.
    Your shell: POSIX with GNU coreutils, whatever the user's computer is. Reach for GNU spellings such as \`stat -c\`, \`date -d\`, and \`sed -i\` with no backup suffix; the BSD forms (\`stat -f\`, \`date -r\`, \`sed -i ''\`) do not exist here.
    Current date: ${formatContextDate(contextDateKey(now))} -- the day this session started. A session that runs past midnight is told the new date on the turn it happens; until then, this is today.
    </system_info>
  `.trim();
}

export async function getTaskLayoutContext(dir: AbsolutePath) {
  const fileTreeResult = await fileTree(dir);

  return fileTreeResult.match(
    (tree) => dedent`
      <task_layout>
      This is the current task directory structure. All files and folders shown below exist right now. This structure will not update during the conversation, but should be considered accurate at the start.
      \`\`\`plaintext
      ${tree}
      \`\`\`
      </task_layout>
    `,
    () => "",
  );
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
