import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { createContext, type ReactNode, useContext } from "react";

interface TaskSession {
  sessionId?: StoreId.Session;
  taskId?: TaskId;
}

const TaskSessionContext = createContext<TaskSession>({});

/**
 * Names the task and session everything drawn inside belongs to.
 *
 * A context rather than a prop because what reads it is a link, and links are
 * the one thing every surface in a task has: the transcript, a tool's output,
 * a model's reasoning, the sources under an answer, a Markdown file open in the
 * pane. Threading a task and a session to each of those would mean touching
 * every component in between, all of which are only in the way.
 *
 * Empty outside a task, which is what an anchor there degrades against.
 */
export function TaskSessionProvider({
  children,
  sessionId,
  taskId,
}: TaskSession & { children: ReactNode }) {
  return (
    <TaskSessionContext value={{ sessionId, taskId }}>
      {children}
    </TaskSessionContext>
  );
}

/**
 * The task and session in scope, if there is one.
 *
 * Both fields or neither is what callers actually want: the task's browser is
 * one guest per task and session, so a task without a session names no browser
 * to open anything in.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTaskSession(): TaskSession {
  return useContext(TaskSessionContext);
}
