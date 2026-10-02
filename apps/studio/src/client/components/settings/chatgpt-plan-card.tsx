import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Spinner } from "@/client/components/ui/spinner";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { isDefinedError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const USAGE_URL = "https://chatgpt.com/settings/usage";

/**
 * How long Continue shows that the browser is opening. After it, the button
 * is back, and pressing it again starts a fresh sign-in, which is the way
 * past a tab that was closed or never came up.
 */
const OPENING_MS = 4000;

/**
 * The ChatGPT plan as a row among the providers, laid out like
 * `ProviderConfigListItem` so it reads as one of them: the mark, a name and a
 * line, and the actions at the right.
 */
export function ChatGPTPlanCard() {
  const { data: status } = useQuery(
    rpcClient.chatgptPlan.live.status.experimental_liveOptions(),
  );
  const openLink = useOpenExternalLink();
  const [opening, setOpening] = useState(false);
  const openingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(openingTimer.current);
    },
    [],
  );

  const signIn = useMutation(
    rpcClient.chatgptPlan.signIn.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't sign in with ChatGPT", {
          description: isDefinedError(error) ? error.message : undefined,
        });
      },
      onSuccess: async (result) => {
        if (result.state !== "signed-in") {
          return;
        }
        // Said as soon as the sign-in lands; the model it picks follows in
        // the same toast once the plan's catalog is read. The model is said
        // because the change lands in the model picker, which may not be on
        // screen, and the settings window may already be closed.
        const id = toast.success("Signed in with ChatGPT");
        const { name } = await rpcClient.chatgptPlan.chooseDefaultModel
          .call({})
          .catch(() => ({ name: undefined }));
        toast.success("Signed in with ChatGPT", {
          description: name
            ? `New chats use ${name} from your plan.`
            : "Your plan's models are in the model picker.",
          id,
        });
      },
    }),
  );
  const signOut = useMutation(rpcClient.chatgptPlan.signOut.mutationOptions());

  const continueWithChatGPT = () => {
    clearTimeout(openingTimer.current);
    setOpening(true);
    openingTimer.current = setTimeout(() => {
      setOpening(false);
    }, OPENING_MS);
    signIn.mutate({});
  };

  const state = status?.state ?? "signed-out";
  const email = status && "email" in status ? status.email : undefined;
  const signedIn = state === "signed-in" || state === "plan-disabled";

  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center">
            <AIProviderIcon type="chatgpt" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="truncate font-medium text-foreground">
              {signedIn ? "ChatGPT plan" : "Use your ChatGPT plan"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {state === "signed-in"
                ? (email ?? "Signed in")
                : state === "plan-disabled"
                  ? `${APP_NAME} isn't allowed to use your plan yet`
                  : `${APP_NAME} can run on the ChatGPT Plus or Pro plan you already pay for.`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state === "signed-in" ? (
            <>
              <Button
                onClick={() => {
                  signOut.mutate({});
                }}
                variant="ghost"
              >
                Sign out
              </Button>
              <Button
                onClick={() => {
                  openLink(USAGE_URL, { addReferral: false });
                }}
                variant="outline"
              >
                Manage usage
              </Button>
            </>
          ) : (
            // The label stays in place under the spinner, so the button
            // keeps its width and nothing beside it rewraps.
            <Button
              className="relative"
              disabled={opening}
              onClick={continueWithChatGPT}
            >
              <span className={cn(opening && "invisible")}>
                {state === "plan-disabled"
                  ? "Allow plan use"
                  : "Continue with ChatGPT"}
              </span>
              {opening && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Spinner className="size-4" delay={0} />
                </span>
              )}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
