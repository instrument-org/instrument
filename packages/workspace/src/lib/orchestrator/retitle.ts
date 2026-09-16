import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { alphabetical } from "radashi";

import { publisher } from "../../rpc/publisher";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { generateTitleFromUserMessage } from "../generate-title-from-user-message";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { updateSessionTitle } from "../update-session-title";
import { getWorkspaceConfig } from "../workspace-config";
import { lastAssistantTextIn } from "./latest-session";

/** How much of the latest reply the title call reads. */
const REPLY_MAX = 600;

/**
 * Keeps a thread's title current as the thread goes on.
 *
 * The title is written from the opening message, before anything has been
 * done; a thread that ran for days is about what it became. So each finished
 * turn of an orchestrator's thread names it again from the root and the
 * latest reply, through the same call that named it first. One subscriber
 * over the session-done topic for the life of the process; a turn that ended
 * without words, or in a task's session, is left alone.
 */
export function startThreadRetitle(): void {
  void (async () => {
    for await (const payload of publisher.subscribe("session.done")) {
      try {
        await retitleThread(payload);
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}

function isRoot(
  message: SessionMessage.WithParts,
): message is SessionMessage.UserWithParts {
  return (
    message.role === "user" &&
    message.parts.some(
      (part) => part.type === "text" && part.text.trim() !== "",
    )
  );
}

async function retitleThread({
  id,
  parentSessionId,
  sessionId,
}: {
  id: TaskId;
  parentSessionId: StoreId.Session | undefined;
  sessionId: StoreId.Session;
}) {
  if (parentSessionId) {
    return;
  }
  const settings = await getTaskSettings(taskDir(id));
  if (settings?.kind !== "orchestrator") {
    return;
  }
  const messages = await Store.getMessagesWithParts({ sessionId, taskId: id });
  if (messages.isErr()) {
    return;
  }
  const sorted = alphabetical(messages.value, (message) => message.id);
  const root = sorted.find(isRoot);
  const reply = lastAssistantTextIn(sorted, REPLY_MAX);
  if (!root || !reply) {
    return;
  }
  const state = await getTaskState(taskDir(id));
  if (!state.selectedModelURI) {
    return;
  }
  const workspaceConfig = getWorkspaceConfig();
  const model = await fetchModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI: AIGatewayModelURI.Schema.parse(state.selectedModelURI),
  });
  if (!model.ok) {
    return;
  }
  const session = await Store.getSession(sessionId, id);
  if (session.isErr()) {
    return;
  }
  const title = await generateTitleFromUserMessage({
    message: root,
    model: model.value,
    reply,
    workspaceConfig,
  });
  if (title.isErr() || title.value === session.value.title) {
    return;
  }
  // Replaced only while the title is still the one read above: a title that
  // landed meanwhile (the opening call finishing late) is the newer fact.
  await updateSessionTitle({
    expectedCurrentTitle: session.value.title,
    sessionId,
    taskId: id,
    title: title.value,
  });
}
