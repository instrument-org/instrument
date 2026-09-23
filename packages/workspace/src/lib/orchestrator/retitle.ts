import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { alphabetical } from "radashi";

import { publisher } from "../../rpc/publisher";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { isUntitledChatSessionTitle } from "../generate-session-title";
import { generateTitleFromUserMessage } from "../generate-title-from-user-message";
import { truncateAtWordBoundary } from "../sanitize-model-text";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { updateSessionTitle } from "../update-session-title";
import { getWorkspaceConfig } from "../workspace-config";
import { lastAssistantTextIn } from "./latest-session";
import { settleThreadTitle, threadIsWorking } from "./threads";

/** How much of the latest reply the title call reads. */
const REPLY_MAX = 600;

/**
 * Names a thread again from its root and its latest reply, and says what it
 * is called now: the new title, the one it already had when the call agreed
 * with it, or nothing when the thread has no reply to be named from or no
 * model to ask. `keep` asks the call to hold on to an agent-given title
 * unless the subject has moved; without it, as on the user's own ask, the
 * call names the thread afresh.
 */
export async function retitleThread({
  id,
  keep = false,
  parentSessionId,
  sessionId,
}: {
  id: TaskId;
  keep?: boolean;
  parentSessionId?: StoreId.Session | undefined;
  sessionId: StoreId.Session;
}): Promise<string | undefined> {
  if (parentSessionId) {
    return undefined;
  }
  const settings = await getTaskSettings(taskDir(id));
  if (settings?.kind !== "orchestrator") {
    return undefined;
  }
  const messages = await Store.getMessagesWithParts({ sessionId, taskId: id });
  if (messages.isErr()) {
    return undefined;
  }
  const sorted = alphabetical(messages.value, (message) => message.id);
  const root = sorted.find(isRoot);
  // Cut plainly: the note-shaped cut addresses the conversation, and this
  // reply is going to the title model.
  const said = lastAssistantTextIn(sorted);
  const reply =
    said === undefined ? undefined : truncateAtWordBoundary(said, REPLY_MAX);
  if (!root || !reply) {
    return undefined;
  }
  const state = await getTaskState(taskDir(id));
  if (!state.selectedModelURI) {
    return undefined;
  }
  const workspaceConfig = getWorkspaceConfig();
  const model = await fetchModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI: AIGatewayModelURI.Schema.parse(state.selectedModelURI),
  });
  if (!model.ok) {
    return undefined;
  }
  const session = await Store.getSession(sessionId, id);
  if (session.isErr()) {
    return undefined;
  }
  // A placeholder is the ask's own first words, not a name worth keeping.
  const currentTitle =
    keep && !isUntitledChatSessionTitle(session.value.title)
      ? session.value.title
      : undefined;
  const title = await generateTitleFromUserMessage({
    currentTitle,
    message: root,
    model: model.value,
    reply,
    workspaceConfig,
  });
  if (title.isErr()) {
    return undefined;
  }
  if (title.value === session.value.title) {
    return title.value;
  }
  // Replaced only while the title is still the one read above: a title that
  // landed meanwhile (the opening call finishing late) is the newer fact.
  await updateSessionTitle({
    expectedCurrentTitle: session.value.title,
    sessionId,
    taskId: id,
    title: title.value,
  });
  return title.value;
}

/**
 * Names a thread once more, when its first exchange has settled.
 *
 * The title is written from the opening message, before anything has been
 * done; by the time the thread's agent and every task it filed have stopped,
 * the work has said what it is about, so the thread is named again from the
 * root and the latest reply. That is the whole of it: a title that kept
 * moving would be one the user loses in the list, so after the first settle,
 * or once the user has named the thread themselves, only the user renames it. A turn that leaves something of
 * the thread's still working (a hand-off, a task's report while another
 * runs) waits for the one that settles it, the same moment a notification
 * treats as news.
 */
export function startThreadRetitle(): void {
  void (async () => {
    for await (const payload of publisher.subscribe("session.done")) {
      try {
        await retitleOnSettle(payload);
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

async function retitleOnSettle({
  id,
  parentSessionId,
  sessionId,
}: {
  id: TaskId;
  parentSessionId?: StoreId.Session | undefined;
  sessionId: StoreId.Session;
}): Promise<void> {
  if (parentSessionId) {
    return;
  }
  const settings = await getTaskSettings(taskDir(id));
  if (settings?.kind !== "orchestrator") {
    return;
  }
  const session = await Store.getSession(sessionId, id);
  if (session.isErr() || session.value.titleSettledAt) {
    return;
  }
  if (await threadIsWorking(id, sessionId)) {
    return;
  }
  const title = await retitleThread({ id, keep: true, sessionId });
  if (title !== undefined) {
    await settleThreadTitle(id, sessionId);
  }
}
