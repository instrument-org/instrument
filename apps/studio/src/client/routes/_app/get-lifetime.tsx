import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/get-lifetime")({
  beforeLoad: async () => {
    const { data: hasToken } = await safe(rpcClient.auth.hasToken.call());
    if (!hasToken) {
      // Not logged in: prompt login via the app-wide modal, then land on the
      // new tab screen.
      void rpcClient.studioOverlay.show.call({ kind: "login" });
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/new-tab" });
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ search: { dialog: "lifetime" }, to: "/new-tab" });
  },
});
