import { type AgentName } from "../agents/types";
import { type ChatId } from "../schemas/chat-id";
import { type FolderAttachment } from "../schemas/folder-attachment";
import { type TaskId } from "../schemas/task-id";
import { type StoreId } from "../schemas/store-id";
import { type TaskSettings } from "../schemas/task-settings";
import { type TaskState } from "../schemas/task-state";
import { folderReach } from "./chat/folder-reach";
import { owningChat, resolveChat, sessionOfChat } from "./record-folders";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings } from "./task-settings";
import { isForkOnly, ONE_AGENT_NAME, oneAgentMode } from "./one-agent-mode";
import { getWorkspaceConfig } from "./workspace-config";

export {
  BACKGROUND_COMMAND_NAME,
  FORK_ON_INTERRUPT,
  forkCommandName,
  forksToBackground,
  inForkWords,
  isForkOnly,
  isForkOnlyEnabled,
  ONE_AGENT_NAME,
  oneAgentMode,
  parseOneAgentMode,
} from "./one-agent-mode";

/**
 * Whether a message the user sends mid-turn forks the turn to the background
 * rather than ending it: always in the fork-only modes, and in `fork` under
 * the `one_agent_fork_on_interrupt` flag. `foreground` has no background to
 * fork to.
 */
export function isForkOnInterruptEnabled(): boolean {
  const mode = oneAgentMode();
  return (
    isForkOnly(mode) ||
    (mode === "fork" &&
      (getWorkspaceConfig().isForkOnInterruptEnabled?.() ?? false))
  );
}

/** The `one_agent` feature flag, in any mode. */
export function isOneAgentEnabled(): boolean {
  return oneAgentMode() !== undefined;
}

/**
 * The `task_context` feature flag: a task a chat briefs gets the chat's
 * background beside its brief. Only the delegating chat briefs tasks, so it
 * is off whenever the one agent is on.
 */
export function isTaskContextEnabled(): boolean {
  return (
    !isOneAgentEnabled() &&
    (getWorkspaceConfig().isTaskContextEnabled?.() ?? false)
  );
}

/**
 * The chat an agent speaks for, when it runs in one: the chat's own agent of
 * either design, in the chat's folder. A fork runs the one agent too, but in a
 * task's folder, so it speaks for none.
 */
export function chatSpokenFor(
  agentName: AgentName,
  taskId: TaskId,
): ChatId | undefined {
  return agentName === "instrument" || agentName === ONE_AGENT_NAME
    ? resolveChat(taskId)
    : undefined;
}

/**
 * Which agent answers in one of a chat's tasks: the one agent for a fork,
 * whose session carries the chat's conversation, and the task agent for
 * everything else.
 */
export async function agentNameForChild(taskId: TaskId): Promise<AgentName> {
  const settings = await getTaskSettings(taskDir(taskId));
  return settings?.fork ? ONE_AGENT_NAME : "main";
}

/**
 * The folders a file tool mounts. The one agent works with its own file
 * tools, so in a chat they reach what its shell does: the home and workspace
 * folders and the topics' beside the folders on its record. Every other
 * agent's file tools reach the record alone, as a task's always have.
 */
export async function toolFolders(
  agentName: AgentName,
  taskId: TaskId,
  state: TaskState,
): Promise<Record<string, FolderAttachment.Type> | undefined> {
  return agentName === ONE_AGENT_NAME
    ? await folderReach(taskId, state)
    : state.attachedFolders;
}

/**
 * The session a request names to the provider, which is what its prompt
 * cache is routed by (Workers AI's affinity, the ChatGPT plan's session): a
 * request's own, except a fork's, which names its chat's. A fork's first
 * request is the chat's conversation byte for byte, and that prefix is
 * cached wherever the chat's requests went.
 */
export function cacheSessionFor({
  sessionId,
  settings,
  taskId,
}: {
  sessionId: StoreId.Session;
  settings: TaskSettings | undefined;
  taskId: TaskId;
}): StoreId.Session {
  if (!settings?.fork) {
    return sessionId;
  }
  const chatId = owningChat(taskId);
  return (chatId && sessionOfChat(chatId)) ?? sessionId;
}
