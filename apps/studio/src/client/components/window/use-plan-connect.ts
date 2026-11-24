import {
  useChatGPTConnect,
  useClaudeConnect,
  useGrokConnect,
} from "@/client/hooks/use-connect";
import { type PlanProvider } from "@/client/hooks/use-connected-plans";
import { showConnectToast } from "@/client/lib/connect-toast";
import { useContext } from "react";

import { WindowContext } from "./context";
import { useOptionalPlanSignIns } from "./plan-sign-in";
import { type SignInDestination } from "./use-sign-in-landing";

/**
 * A plan's sign-in from a surface that isn't the AI's own page (Providers in
 * Settings, a stopped turn): the window's, which can open in its own browser
 * and says how it went in a toast; outside the app window, its own, which
 * only goes to the person's browser.
 */
export function usePlanConnect() {
  const appWindow = useContext(WindowContext);
  const signIns = useOptionalPlanSignIns();
  const flows = {
    chatgpt: useChatGPTConnect(),
    claude: useClaudeConnect(),
    grok: useGrokConnect(),
  };
  const canSignInHere = signIns !== null && Boolean(appWindow?.browser);

  const start = (
    provider: PlanProvider,
    { accountId, where }: { accountId?: string; where: SignInDestination },
  ) => {
    if (signIns !== null && appWindow !== null) {
      signIns[provider].start({
        accountId,
        openPage: appWindow.openPage,
        where: canSignInHere ? where : "external",
      });
      return;
    }
    const started =
      provider === "chatgpt"
        ? flows.chatgpt.start(accountId ? { accountId } : undefined)
        : flows[provider].start();
    void started.then((result) => {
      if (result) {
        showConnectToast(result, provider, () => {
          start(provider, { ...(accountId && { accountId }), where });
        });
      }
    });
  };
  return {
    canSignInHere,
    cancel: (provider: PlanProvider) => {
      (signIns ?? flows)[provider].cancel();
    },
    phase: (provider: PlanProvider) => (signIns ?? flows)[provider].phase,
    start,
    /** Where a sign-in under way was sent, or undefined while none is. */
    waitingIn: (provider: PlanProvider): SignInDestination | undefined =>
      signIns
        ? signIns[provider].waitingIn
        : flows[provider].waiting
          ? "external"
          : undefined,
  };
}
