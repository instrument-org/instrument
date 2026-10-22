import { rpcClient } from "@/client/rpc/client";
import { type ConnectProvider } from "@/shared/connect-outcome";
import { useQuery } from "@tanstack/react-query";

export type PlanProvider = Exclude<ConnectProvider, "instrument">;

/**
 * Which plans are signed in and usable now, from each account's own status,
 * or undefined until all three have answered.
 */
export function useConnectedPlans(): Record<PlanProvider, boolean> | undefined {
  const { data: chatgpt } = useQuery(
    rpcClient.chatgptAccount.live.status.experimental_liveOptions(),
  );
  const { data: claude } = useQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  const { data: grok } = useQuery(
    rpcClient.grokAccount.live.status.experimental_liveOptions(),
  );
  if (!chatgpt || !claude || !grok) {
    return undefined;
  }
  return {
    chatgpt: chatgpt.accounts.some((account) => account.state === "signed-in"),
    claude: claude.kind === "signed-in",
    grok: grok.accounts.some((account) => account.state === "signed-in"),
  };
}
