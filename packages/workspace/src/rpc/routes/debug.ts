import ms from "ms";
import { z } from "zod";

import { createBashEnv } from "../../lib/create-bash-env";
import { folderReach } from "../../lib/chat/folder-reach";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { base } from "../base";
import { resolveChat } from "../../lib/record-folders";

/**
 * Per stream, so one runaway command cannot pin the message port. Generous
 * enough that a check reads its own output rather than working around this.
 */
const RUN_BASH_STREAM_LIMIT = 256 * 1024;

/**
 * No real caller aborts the oRPC signal (the debug bridge fires and forgets),
 * so the time bound lives here: without one a hung command holds its bash env
 * and any shim subprocess until just-bash's own one-hour execution deadline.
 * Generous next to the agent tool's 30s because a debug check may cold-start
 * uv or pnpm; the cap keeps an override from reopening the hour-long hole.
 */
const RUN_BASH_DEFAULT_TIMEOUT_MS = ms("2 minutes");
const RUN_BASH_MAX_TIMEOUT_MS = ms("10 minutes");

function clampStream(stream: string) {
  return stream.slice(0, RUN_BASH_STREAM_LIMIT);
}

/**
 * Runs one command in a task's real sandbox and hands back the streams
 * unmerged, which is what separates this from the agent's `bash` tool: that
 * tool joins stdout and stderr and truncates the result for a model's context,
 * so a check asking which stream a shim wrote to cannot read its own answer.
 *
 * The mounts, command shims, network policy, and bundled binaries are the
 * running build's, so this reports on a package rather than on a checkout --
 * the difference that decides whether a bundling gap is visible at all.
 *
 * Reachable only from the renderer over the message port, and from outside
 * only through `window.__studioDebug`, which refuses without the Developer
 * Mode preference and needs the app launched with a remote debugging port. No
 * gate here repeats that, because the workspace package has no view of a
 * Studio preference and this transport never reaches the network.
 */
const runBash = base
  .input(
    z.object({
      command: z.string().min(1),
      sessionId: StoreId.SessionSchema,
      taskId: TaskIdSchema,
      timeoutMs: z
        .number()
        .int()
        .min(1)
        .max(RUN_BASH_MAX_TIMEOUT_MS)
        .default(RUN_BASH_DEFAULT_TIMEOUT_MS),
    }),
  )
  .output(
    z.object({
      durationMs: z.number(),
      exitCode: z.number(),
      stderr: z.string(),
      stdout: z.string(),
      truncated: z.boolean(),
    }),
  )
  .handler(async ({ input, signal }) => {
    // A chat's own shell, with the commands the chat runs, for the chat's
    // agent; a task's otherwise, the way the bash tool builds it.
    const chatId = resolveChat(input.taskId);
    const bash = await createBashEnv({
      attachedFolders: await folderReach(input.taskId),
      ...(chatId ? { chat: { id: chatId } } : {}),
      sessionId: input.sessionId,
      taskId: input.taskId,
    });

    const startedAt = performance.now();
    const timeout = AbortSignal.timeout(input.timeoutMs);

    try {
      const result = await bash.exec(input.command, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      return {
        durationMs: Math.round(performance.now() - startedAt),
        exitCode: result.exitCode,
        stderr: clampStream(result.stderr),
        stdout: clampStream(result.stdout),
        truncated:
          result.stdout.length > RUN_BASH_STREAM_LIMIT ||
          result.stderr.length > RUN_BASH_STREAM_LIMIT,
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      // just-bash throws for some filesystem failures instead of exiting
      // non-zero. Report it as a failed command so a check reads a result
      // rather than an RPC error.
      return {
        durationMs: Math.round(performance.now() - startedAt),
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error),
        stdout: "",
        truncated: false,
      };
    }
  });

export const debug = { runBash };
