import { z } from "zod";

/**
 * What a task is for.
 *
 * An orchestrator is the task the user talks to: it runs the `instrument`
 * agent, never does the work itself, and creates tasks of the plain kind to do
 * it. A plain task is every task there was before orchestrators existed, so the
 * field is absent on those rather than written as `task`.
 */
export const TaskKindSchema = z.enum(["orchestrator", "task"]);

export type TaskKind = z.output<typeof TaskKindSchema>;
