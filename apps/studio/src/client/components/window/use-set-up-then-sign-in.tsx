import { Button } from "@/client/components/ui/button";
import { toast } from "@/client/lib/toast";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { ConnectControls } from "./connect-controls";
import { useWindow } from "./context";
import { SignInButton } from "./sign-in-button";
import { type SignInDestination } from "./use-sign-in-landing";

type App = RPCOutput["apps"]["list"]["apps"][number];

/**
 * The button that signs in to a service, one nothing here is set up for yet
 * included: that press sets the app up, then starts the sign-in once the app
 * is here.
 */
export function useSetUpThenSignIn({
  app,
  entrySlug,
  failure,
  fix,
  kind,
  name,
  onNeedsAgent,
  slug,
}: {
  app: App | undefined;
  entrySlug: string;
  failure?: "failed" | "refused" | undefined;
  fix?: () => void;
  kind: "sign-in" | "web";
  name: string;
  /** For a service the directory cannot set up by itself. */
  onNeedsAgent?: () => void;
  slug: string;
}) {
  const { browser, openScreen } = useWindow();
  const [startsIn, setStartsIn] = useState<SignInDestination>();
  const stop = () => {
    setStartsIn(undefined);
  };
  const setUp = useMutation(
    rpcClient.apps.setUp.mutationOptions({
      onError: (error) => {
        stop();
        toast.error(`Couldn't set up ${name}`, { cause: error });
      },
      onSuccess: (result) => {
        if (result.kind === "agent") {
          stop();
          onNeedsAgent?.();
        } else if (result.slug !== slug) {
          stop();
          openScreen(`/apps/${result.slug}`);
        }
      },
    }),
  );
  if (app !== undefined) {
    return {
      controls: (
        <ConnectControls
          failure={failure}
          {...(fix && { fix })}
          kind={kind}
          name={name}
          onStarted={stop}
          slug={slug}
          startsIn={startsIn}
        />
      ),
    };
  }
  const start = (where: SignInDestination) => {
    setStartsIn(where);
    setUp.mutate({ slug: entrySlug });
  };
  const off = setUp.isPending || startsIn !== undefined;
  return {
    controls:
      kind === "web" ? (
        <Button
          className="min-w-24"
          disabled={off || !browser}
          onClick={() => {
            start("app");
          }}
          size="sm"
          variant="brand"
        >
          Sign in
        </Button>
      ) : (
        <SignInButton
          busy={off}
          canSignInHere={Boolean(browser)}
          onCancel={stop}
          onStart={start}
          variant="brand"
          waiting={false}
        />
      ),
  };
}
