import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/tutorial-task")({
  loader: async () => {
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
