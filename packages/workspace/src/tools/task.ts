import { encodeUtf8ToBytes } from "just-bash";
import ms from "ms";
import { ok } from "neverthrow";
import { z } from "zod";

import { executeError } from "../lib/execute-error";
import { runNew, runSend, runStop } from "../lib/shell-commands/task";
import { TASK_COMMAND } from "../lib/shell-commands/task-command";
import { MOUNT } from "../mount-points";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/**
 * Starting, steering and stopping a task, as a tool rather than as a command
 * inside the shell.
 *
 * The shell is where these live today, and the weaker models keep reaching for
 * them as tools anyway: measured over a five-case suite, GLM 5.3 Flash spent
 * two to four calls a run on a tool literally named `task` or `open`, each one
 * an error that ends the step and buys nothing, while the frontier control
 * never did it once. A model that wants to call a tool should be given the
 * tool.
 *
 * It is deliberately only the three verbs that *do* something. Reading -- the
 * list, the log, what a task made -- stays in the shell, where it composes with
 * a filter and costs a fraction of the context a structured result would.
 *
 * The work itself is the same work: each verb builds the command line its
 * subcommand already parses and hands it over, so the containment check on
 * `--folder`, the app resolution, the workspace-folder attachment and the
 * turn-ending rule cannot drift from what the shell does.
 */
export const Task = setupTool({
  inputSchema: BaseInputSchema.extend({
    action: z.enum(["new", "send", "stop"]).meta({
      description: "What to do: start a task, message one, or stop one.",
    }),
    apps: z.array(z.string()).optional().meta({
      description:
        "new: connected apps this task may reach, by slug. It reaches no other.",
    }),
    brief: z.string().optional().meta({
      description:
        "new: the task's whole brief, for a capable colleague who knows nothing about this conversation -- the goal, what done looks like, which folder holds what, where the deliverable goes, and how much effort it deserves. send: the message.",
    }),
    folders: z
      .array(z.string())
      .optional()
      .meta({
        description: `new: folders the task may reach, as mounts under ${MOUNT.attachedFolders} or a folder inside one, with :ro to narrow to read-only. It sees none you do not name, beyond the workspace folder it always has.`,
      }),
    model: z.string().optional().meta({
      description:
        "new: the model URI this task runs on for its whole life. Omit to use this conversation's.",
    }),
    name: z.string().optional().meta({
      description: "new: a short title, in the user's words.",
    }),
    tab: z.string().optional().meta({
      description:
        "new: a browser tab of the user's to hand the task, by the id the note on their message gives.",
    }),
    taskId: z.string().optional().meta({
      description: "send and stop: which task.",
    }),
  }),
  name: "task",
  outputSchema: z.object({
    output: z.string(),
    /** False when the subcommand refused; `output` says why. */
    ok: z.boolean(),
  }),
}).create({
  description: `Start a task, send one a message, or stop one. A task is a capable agent with its own tools, folder, browser and model; it knows nothing about this conversation beyond the brief you give it, and you are told when it finishes. Everything that touches a file, a page, a service, or the web is a task's. Reading about tasks stays in the shell: \`${TASK_COMMAND.name} list\`, \`${TASK_COMMAND.name} show <id>\`, \`${TASK_COMMAND.name} log <id>\`, \`${TASK_COMMAND.name} models\`.`,
  execute: async ({ input, taskId }) => {
    const context = {
      orchestratorTaskId: taskId,
      remainingYieldMs: () => 0,
    };
    const brief = encodeUtf8ToBytes(input.brief ?? "");
    try {
      const result = await (input.action === "new"
        ? runNew(
            [
              ...(input.name ? ["--name", input.name] : []),
              ...(input.model ? ["--model", input.model] : []),
              ...(input.tab ? ["--tab", input.tab] : []),
              ...(input.folders ?? []).flatMap((folder) => [
                "--folder",
                folder,
              ]),
              ...(input.apps ?? []).flatMap((app) => ["--app", app]),
            ],
            context,
            brief,
          )
        : input.action === "send"
          ? runSend([input.taskId ?? ""], context, brief)
          : runStop([input.taskId ?? ""], context));
      return ok({
        ok: result.exitCode === 0,
        output: result.exitCode === 0 ? result.stdout : result.stderr,
      });
    } catch (error) {
      return executeError(
        error instanceof Error ? error.message : String(error),
      );
    }
  },
  readOnly: false,
  // Starting a task is a write to the store and a message send, not a wait on
  // the task itself: the conversation is told when it finishes, and is told not
  // to wait for it.
  timeoutMs: ms("30 seconds"),
  toModelOutput: ({ output }) =>
    output.ok
      ? { type: "text", value: output.output }
      : { type: "error-text", value: output.output },
});
