import { type AgentName } from "../agents/types";
import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings } from "./task-settings";

/**
 * Which agent answers in a task: the orchestrator's own for an orchestrator,
 * the working agent for everything else. Read from the task's record rather
 * than passed by the caller, so a message sent from any surface runs the agent
 * the task was created for.
 */
export async function agentNameForTask(taskId: TaskId): Promise<AgentName> {
  const settings = await getTaskSettings(taskDir(taskId));
  return settings?.kind === "orchestrator" ? "instrument" : "main";
}
