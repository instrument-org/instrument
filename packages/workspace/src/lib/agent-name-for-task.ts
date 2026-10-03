import { type AgentName } from "../agents/types";
import { type TaskId } from "../schemas/task-id";
import { isChatId } from "./record-folders";

/**
 * Which agent answers in a task: the chat's own for a chat,
 * the working agent for everything else. Read from where the task's folder
 * is rather than passed by the caller, so a message sent from any surface
 * runs the agent the task was created for.
 */
export function agentNameForTask(taskId: TaskId): AgentName {
  return isChatId(taskId) ? "instrument" : "main";
}
