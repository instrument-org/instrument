import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { ConnectIcon } from "@/client/components/connect-button";
import { type ConnectResult } from "@/client/hooks/use-connect-flow";
import { type ConnectProvider } from "@/shared/connect-outcome";
import { OUR_MODELS } from "@instrument-org/shared";

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
  toast.success(copy.title, {
    description: copy.description,
    icon: <SuccessMark provider={provider} />,
  });
}

/**
 * A success leads with the mark of what it connected, so it reads apart from
 * every other toast; a failure keeps the warning, whose color is the news.
 * Instrument is its own mark here, not Google's, since signing in is how it
 * was reached rather than what it is.
 */
function SuccessMark({ provider }: { provider: ConnectProvider }) {
  return provider === "instrument" ? (
    <AIProviderIcon className="size-4" colored type={OUR_MODELS.providerType} />
  ) : (
    <ConnectIcon className="size-4" provider={provider} />
  );
}
