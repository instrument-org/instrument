import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/get-lifetime")({
  beforeLoad: async () => {
    const { data: hasToken } = await safe(rpcClient.auth.hasToken.call());
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      // If they aren't logged in, show the login dialog instead.
      search: { dialog: hasToken ? "lifetime" : "login" },
      to: "/new-tab",
    });
  },
});
