import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/tutorial-task")({
  loader: async () => {
    const [error, result] = await safe(
      rpcClient.workspace.task.createTutorial.call(),
    );

    if (error) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ replace: true, to: "/new-tab" });
    }

    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      params: { subdomain: result.subdomain },
      replace: true,
      search: { selectedSessionId: result.sessionId },
      to: "/projects/$subdomain",
    });
  },
});
