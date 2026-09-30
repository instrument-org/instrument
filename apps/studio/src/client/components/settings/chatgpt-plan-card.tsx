import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Spinner } from "@/client/components/ui/spinner";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { isDefinedError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { SiOpenai } from "react-icons/si";
import { toast } from "sonner";

const USAGE_URL = "https://chatgpt.com/settings/usage";

/**
 * How long Continue shows that the browser is opening. After it, the button
 * is back, and pressing it again starts a fresh sign-in, which is the way
 * past a tab that was closed or never came up.
 */
const OPENING_MS = 4000;

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
      onSuccess: (result) => {
        if (result.state === "signed-in") {
          toast.success("You're using your ChatGPT plan", {
            description: `${APP_NAME} now uses your plan's GPT models. You can manage usage in ChatGPT settings.`,
          });
        }
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

  return (
    <Card className="gap-0 p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center">
          <SiOpenai className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          {state === "signed-in" || state === "plan-disabled" ? (
            <>
              <h3 className="truncate font-medium text-foreground">
                ChatGPT plan
              </h3>
              <p className="truncate text-sm text-muted-foreground">
                {state === "signed-in"
                  ? (email ?? "Signed in")
                  : `${APP_NAME} isn't allowed to use your plan yet`}
              </p>
            </>
          ) : (
            <>
              <h3 className="truncate font-medium text-foreground">
                Use your ChatGPT plan
              </h3>
              <p className="text-sm text-muted-foreground">
                Use GPT in {APP_NAME} with the usage your ChatGPT Plus or Pro
                plan already includes.
              </p>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state === "signed-in" ? (
            <>
              <Button
                onClick={() => {
                  openLink(USAGE_URL, { addReferral: false });
                }}
                variant="outline"
              >
                Manage usage
              </Button>
              <Button
                disabled={signOut.isPending}
                onClick={() => {
                  signOut.mutate({});
                }}
                variant="ghost"
              >
                Sign out
              </Button>
            </>
          ) : (
            <Button disabled={opening} onClick={continueWithChatGPT}>
              {opening ? (
                <Spinner className="size-4" delay={0} />
              ) : (
                <SiOpenai className="size-4" />
              )}
              {state === "plan-disabled"
                ? "Allow plan use"
                : "Continue with ChatGPT"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
