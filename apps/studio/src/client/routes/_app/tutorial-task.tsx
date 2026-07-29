import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/tutorial-task")({
  loader: async ({ preload }) => {
    // This loader creates a task, so a hover must never reach it. Nothing links
    // here with preload today; the guard keeps the route safe on its own terms
    // rather than resting on the router's global default staying off.
    if (preload) {
      return;
    }

    const [error, result] = await safe(
      rpcClient.workspace.task.createTutorial.call(),
    );

    if (error) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ replace: true, to: "/new-tab" });
    }

    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      params: { id: result.id },
      replace: true,
      search: { selectedSessionId: result.sessionId },
      to: "/tasks/$id",
    });
  },
});
