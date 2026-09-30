import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { isDefinedError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SiOpenai } from "react-icons/si";
import { toast } from "sonner";

const USAGE_URL = "https://chatgpt.com/settings/usage";
const LINKED_APPS_URL = "https://chatgpt.com/settings/security?view=linked-apps";

export function ChatGPTPlanCard() {
  const { data: status } = useQuery(
    rpcClient.chatgptPlan.live.status.experimental_liveOptions(),
  );
  const openLink = useOpenExternalLink();
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
            description:
              "Your plan's models are in the model picker. You can manage usage in ChatGPT settings.",
          });
        }
      },
    }),
  );
  const signOut = useMutation(
    rpcClient.chatgptPlan.signOut.mutationOptions({
      onSuccess: ({ revoked }) => {
        // Signing out ends this app's session; the app stays connected to the
        // ChatGPT account until it is disconnected there.
        toast(
          revoked
            ? "Signed out of ChatGPT"
            : "Signed out, but ChatGPT didn't confirm it",
          {
            action: {
              label: "Disconnect in ChatGPT",
              onClick: () => {
                openLink(LINKED_APPS_URL, { addReferral: false });
              },
            },
            description: `To remove ${APP_NAME} from your ChatGPT account, disconnect it in ChatGPT settings.`,
          },
        );
      },
    }),
  );

  const state = status?.state ?? "signed-out";
  const account =
    status && "email" in status && status.email
      ? status.email
      : "your ChatGPT account";

  const title =
    state === "signed-in" ? "Using your ChatGPT plan" : "Use your ChatGPT plan";
  const description = (() => {
    switch (state) {
      case "plan-disabled": {
        return `Signed in as ${account}, but ${APP_NAME} isn't allowed to use your plan yet.`;
      }
      case "signed-in": {
        return `Signed in as ${account}. Your plan's models are in the model picker.`;
      }
      case "signed-out": {
        return "Use GPT models with your ChatGPT Plus or Pro plan. Usage counts toward your plan's limits.";
      }
      case "signing-in": {
        return "Finish signing in in your browser. If nothing opened, continue again.";
      }
    }
  })();

  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center">
            <SiOpenai className="size-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="truncate font-medium text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
            {state === "signed-in" && (
              <button
                className="text-sm text-foreground underline underline-offset-2"
                onClick={() => {
                  openLink(USAGE_URL, { addReferral: false });
                }}
                type="button"
              >
                Manage usage
              </button>
            )}
          </div>
        </div>
        {state === "signed-in" ? (
          <Button
            className="shrink-0"
            disabled={signOut.isPending}
            onClick={() => {
              signOut.mutate({});
            }}
            variant="outline"
          >
            Sign out
          </Button>
        ) : (
          <Button
            className="shrink-0"
            onClick={() => {
              signIn.mutate({});
            }}
          >
            <SiOpenai className="size-4" />
            {state === "plan-disabled"
              ? "Allow plan use"
              : "Continue with ChatGPT"}
          </Button>
        )}
      </div>
    </Card>
  );
}
