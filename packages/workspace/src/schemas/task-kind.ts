import { z } from "zod";

/**
 * What a task is for.
 *
 * An orchestrator is the task the user talks to: it runs the `instrument`
 * agent, never does the work itself, and creates tasks to do it, each written
 * as `task` with the orchestrator as its `parentTaskId`. A task a person made
 * carries no kind at all.
 */
export const TaskKindSchema = z.enum(["orchestrator", "task"]);

export type TaskKind = z.output<typeof TaskKindSchema>;
