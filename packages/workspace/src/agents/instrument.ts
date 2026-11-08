import { err, ok, safeTry } from "neverthrow";
import { pick } from "radashi";

import { buildAppsContextText } from "../lib/apps/context";
import { buildAvailableSkillsContext } from "../model-text/context/available-skills-context";
import { buildFoldersText } from "../model-text/context/build-folders-text";
import { ChatReads } from "../lib/chat-reads";
import { chatModelURI } from "../lib/chat-settings";
import { ChatWrites } from "../lib/chat-writes";
import { folderReach } from "../lib/chat/folder-reach";
import { endOfTurnNote } from "../lib/end-of-turn-checks";
import { currentEnvironment } from "../lib/environment";
import { runningModelText } from "../model-text/notes/model-change-model-text";
import { TypedError } from "../lib/errors";
import { getCurrentDate } from "../lib/get-current-date";
import { getWorkspaceConfig } from "../lib/workspace-config";
import {
  beginSetupChangeTracking,
  consumeSetupChanges,
} from "../lib/setup-changes";
import {
  appsToldByTurn,
  currentChatApps,
  lastToldApps,
} from "../lib/chat-app-changes";
import { memoryToldByTurn } from "../lib/create-memory-part";
import { grantedFolders } from "../lib/folder-changes";
import { currentSkills, skillsToldByTurn } from "../lib/setup-news";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { TOOLS } from "../tools/all";
import { askedOnCard } from "../tools/connect-app-output";
import {
  FOLDERS_INTRO,
  getSystemInfoText,
  getUserText,
  networkText,
  NO_FOLDERS_TEXT,
} from "../model-text/context/context-message";
import { pythonBaseText, systemPrompt } from "../model-text/system-prompt";
import { setupAgent } from "./create-agent";
import {
  createContextMessage,
  createSystemMessage,
  shouldContinueWithToolCalls,
} from "./shared";

/**
 * The agent the user talks to, and the only one: it does the work itself,
 * with its own files, shell, browser, web search, and skills, and what is
 * multi-step or slow it starts as a task, a fork of itself that carries the
 * conversation and works in the same folder (`instrument task new`, in
 * `lib/capabilities/task/fork.ts`). A fork runs this same agent, so its
 * system prompt and tool definitions are the chat's byte for byte and a
 * provider's prefix cache serves the conversation it inherits.
 */
export const instrumentAgent = setupAgent({
  agentTools: pick(TOOLS, [
    "AskPermission",
    "BashTool",
    "Choose",
    "ConnectApp",
    "EditFile",
    "GenerateImage",
    "LoadSkill",
    "OfferFeedback",
    "ReadFile",
    "WebFetch",
    "WebSearch",
    "WriteFile",
  ]),
  name: "instrument",
}).create(({ name }) => ({
  getMessages: async ({ sessionId, chatId, model }) => {
    const now = getCurrentDate();

    const systemMessage = createSystemMessage({
      agentName: name,
      now,
      sessionId,
      text: systemPrompt(),
    });

    const reached = Object.values(await folderReach(chatId));
    const foldersText =
      reached.length > 0
        ? buildFoldersText({
            folders: reached.map((folder) => ({ path: folder.path })),
            intro: FOLDERS_INTRO,
          })
        : NO_FOLDERS_TEXT;

    const environment = await currentEnvironment(
      chatId,
      await chatModelURI(chatId),
    );
    const userMessage = createContextMessage({
      agentName: name,
      environment,
      now,
      sessionId,
      told: {
        apps: await currentChatApps(),
        folders: await grantedFolders(chatId),
        skills: await currentSkills(),
      },
      textParts: [
        getSystemInfoText({
          environment,
          network: networkText(),
        }),
        runningModelText(model),
        await getUserText(),
        pythonBaseText(),
        foldersText,
        await buildAppsContextText(),
        await buildAvailableSkillsContext(),
      ],
    });

    return [systemMessage, userMessage];
  },
  onFinish: async ({ parentMessageId, sessionId, chatId }) => {
    const changes = await consumeSetupChanges({ id: chatId, sessionId });
    if (changes.length === 0) {
      return;
    }
    const result = await safeTry(async function* () {
      // This run's messages: the one it answered and the session's own after
      // it. A run whose message the session does not have is one whose steps
      // cannot be placed, and reads as none.
      const own = yield* ChatReads.modelHistory({
        chatId,
        inherited: false,
        sessionId,
      });
      const start = own.findIndex(({ id }) => id === parentMessageId);
      const lastAssistantMessage = (
        start === -1 ? [] : own.slice(start)
      ).findLast((message) => message.role === "assistant");
      if (!lastAssistantMessage) {
        return err(new TypedError.NotFound("No assistant message found"));
      }

      // Told through this part, so the next message's notes do not repeat it.
      const apps = await appsToldByTurn({
        names: changes
          .filter((change) => change.kind === "app")
          .map((change) => change.name),
        told: lastToldApps(
          yield* ChatReads.history({ chatId, sessionId }),
          sessionId,
        ),
      });
      const memory = await memoryToldByTurn(changes);
      const skills = await skillsToldByTurn(changes);
      const told = {
        ...(apps && { apps }),
        ...(memory && { memory }),
        ...(skills && { skills }),
      };

      yield* ChatWrites.savePart(
        {
          data: {
            changes,
            ...(Object.keys(told).length > 0 && { told }),
          },
          metadata: {
            createdAt: new Date(),
            id: StoreId.newPartId(),
            messageId: lastAssistantMessage.id,
            sessionId,
          },
          type: "data-setupChanges",
        },
        chatId,
      );

      return ok(undefined);
    });
    if (result.isErr()) {
      getWorkspaceConfig().captureException(result.error);
    }
  },
  onStart: async ({ sessionId, chatId }) => {
    beginSetupChangeTracking({ id: chatId, sessionId });
  },
  // A reply whose links open nothing gets one step more to correct them.
  shouldContinue: async (options) =>
    (await shouldContinueAfterHandingOff(options)) ||
    (await endOfTurnNote(options)) !== undefined,
  systemPrompt,
}));

/**
 * The turn ends once a task has been created or steered and the user has
 * heard a line, or at once once the user has been asked for a folder, an
 * app or a tab, or asked a question or to connect an app on a card: the
 * next word about it comes from the wake, and every model given the chance
 * narrates the hand-off a second time. A step that handed off to a task
 * before saying anything gets one more step, for the line.
 */
export async function shouldContinueAfterHandingOff({
  messages,
}: {
  messages: SessionMessage.WithParts[];
}) {
  const turnStart = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const turn = messages.slice(turnStart + 1);
  const last = turn.findLast((message) => message.role === "assistant");
  if (!last) {
    return shouldContinueWithToolCalls({ messages });
  }
  // A permission card and a sign-in card say why they ask themselves, and a
  // question's card is the whole of the ask, so the turn ends on the call
  // with no step after it for a line, which could land after the answer.
  if (
    last.parts.some(
      (part) =>
        (part.type === "tool-ask_permission" &&
          part.state === "output-available" &&
          part.output.state === "asked") ||
        (part.type === "tool-choose" &&
          part.state === "output-available" &&
          "asked" in part.output) ||
        (part.type === "tool-connect_app" &&
          part.state === "output-available" &&
          askedOnCard(part.output).length > 0) ||
        (part.type === "tool-bash" &&
          part.state === "output-available" &&
          (part.output.asks?.length ?? 0) > 0),
    )
  ) {
    return false;
  }
  const handedOff = last.parts.some(
    (part) =>
      // A task started or sent work. One held until the user answers
      // something (the system's folder ask) is not a hand-off: it waits on
      // them, and the turn stays open to say so.
      part.type === "tool-bash" &&
      part.state === "output-available" &&
      (part.output.handOffs?.length ?? 0) > 0,
  );
  if (!handedOff) {
    return shouldContinueWithToolCalls({ messages });
  }
  const saidSomething = turn.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) => part.type === "text" && part.text.trim() !== "",
      ),
  );
  return !saidSomething;
}
