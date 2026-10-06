import { type AgentName } from "../agents/types";
import { type ChatId } from "../schemas/chat-id";
import { type FolderAttachment } from "../schemas/folder-attachment";
import { type TaskId } from "../schemas/task-id";
import { type TaskState } from "../schemas/task-state";
import { folderReach } from "./chat/folder-reach";
import { resolveChat } from "./record-folders";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings } from "./task-settings";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The agent of the one-agent design (`agents/one.ts`): it answers in a chat
 * when the `one_agent` flag is on, and in every background run the chat forks.
 */
export const ONE_AGENT_NAME = "instrument-one" satisfies AgentName;

/** The `one_agent` feature flag, off unless the host turned it on. */
export function isOneAgentEnabled(): boolean {
  return getWorkspaceConfig().isOneAgentEnabled?.() ?? false;
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
