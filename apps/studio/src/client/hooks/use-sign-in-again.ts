import { showConnectToast } from "@/client/lib/connect-toast";
import { type ConnectProvider } from "@/shared/connect-outcome";
import { type SignInAccountType } from "@/shared/notices";

import {
  useChatGPTConnect,
  useClaudeConnect,
  useGrokConnect,
} from "./use-connect";

const PROVIDER_BY_TYPE = {
  "chatgpt-account": "chatgpt",
  "claude-account": "claude",
  "grok-account": "grok",
} as const satisfies Record<SignInAccountType, ConnectProvider>;

/**
 * Sign in again from where a chat says the account signed out (the note
 * above the reply box, a stopped turn): it starts that service's own sign-in
 * and check, and says how it went in a toast. `accountId` signs in to the same
 * ChatGPT account; Grok's device code always signs in to whichever account
 * the browser approves.
 */
export function useSignInAgain() {
  const flows = {
    chatgpt: useChatGPTConnect(),
    claude: useClaudeConnect(),
    grok: useGrokConnect(),
  };
  const signIn = (type: SignInAccountType, accountId?: string) => {
    const provider = PROVIDER_BY_TYPE[type];
    const started =
      provider === "chatgpt"
        ? flows.chatgpt.start(accountId ? { accountId } : undefined)
        : flows[provider].start();
    void started.then((result) => {
      if (result) {
        showConnectToast(result, provider);
      }
    });
  };
  return {
    cancel: (type: SignInAccountType) => {
      flows[PROVIDER_BY_TYPE[type]].cancel();
    },
    signIn,
    /** Whether a sign-in started here for `type` is under way. */
    waiting: (type: SignInAccountType) => flows[PROVIDER_BY_TYPE[type]].waiting,
  };
}
