import { type ConnectResult } from "@/client/hooks/use-connect-flow";
import { type ConnectProvider } from "@/shared/connect-outcome";

import { connectToast } from "./connect-copy";
import { toast } from "./toast";

/**
 * Says how a connect ended in a toast, for a surface with no room of its own
 * to say it (Settings, a Sign in again started from a chat). A failure's
 * cause shows in developer mode only.
 */
export function showConnectToast(
  { modelName, outcome }: ConnectResult,
  provider: ConnectProvider,
) {
  const copy = connectToast(outcome, provider, { modelName });
  if (!copy) {
    return;
  }
  if (copy.isError) {
    toast.error(copy.title, {
      cause: outcome.kind === "failed" ? outcome.message : undefined,
      description: copy.description,
    });
    return;
  }
  toast.success(copy.title, { description: copy.description });
}
