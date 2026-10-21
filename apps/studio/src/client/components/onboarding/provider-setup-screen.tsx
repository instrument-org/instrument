import { AddProviderForm } from "@/client/components/add-provider/form";
import { BrandMark } from "@/client/components/brand-mark";
import { ConnectButton } from "@/client/components/connect-button";
import { type ConnectResult } from "@/client/hooks/use-connect-flow";
import { instrumentWayCopy } from "@/client/lib/connect-copy";
import { OnboardingScreen } from "@/client/components/onboarding/screen";
import { TermsFooter } from "@/client/components/terms-footer";
import { rpcClient } from "@/client/rpc/client";
import { type ConnectProvider } from "@/shared/connect-outcome";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "../ui/button";

export type ProviderSetupPage = "add-provider" | "welcome";

export function ProviderSetupScreen({
  heading,
  instrumentOnly,
  onAddProvider,
  onBack,
  onContinue,
  onLoginSuccess,
  onPageChange,
  page,
  signedIn,
}: {
  /** In place of the sign-in page's own title and line under it, for a sign-in a feature asked for. */
  heading?: { subtitle: string; title: string };
  instrumentOnly?: boolean;
  onAddProvider?: () => void;
  onBack?: () => void;
  onContinue: () => void;
  /** A way in connected, with how it ended. */
  onLoginSuccess: (result: ConnectResult) => void;
  onPageChange: (page: ProviderSetupPage) => void;
  page: ProviderSetupPage;
  /** Signed in to Instrument already, so the page offers only the providers to add. */
  signedIn?: boolean;
}) {
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const { data: claudeStatus } = useQuery(
    rpcClient.claudeAccount.live.status.experimental_liveOptions(),
  );
  const { data: offer } = useQuery(rpcClient.billing.offer.queryOptions());
  const instrument = instrumentWayCopy(offer);

  // The sign-in holding for the browser, which alone stays on the page until
  // it finishes or is canceled.
  const [holding, setHolding] = useState<ConnectProvider>();
  const holdingChange = (provider: ConnectProvider) => (waiting: boolean) => {
    setHolding((current) =>
      waiting ? provider : current === provider ? undefined : current,
    );
  };
  const shows = (provider: ConnectProvider) => !holding || holding === provider;
  // Ready goes on; any other answer stays here, said under its button, so
  // another way in is one press away.
  const landed = (result: ConnectResult) => {
    if (result.outcome.kind === "ready") {
      onLoginSuccess(result);
    }
  };

  // Signed in to Claude already, there is no Claude plan left to add.
  const offersClaude = !signedIn || claudeStatus?.kind !== "signed-in";

  if (page === "add-provider") {
    return (
      <OnboardingScreen align="top" className="px-11 pt-6 pb-11">
        <AddProviderForm
          onBack={onBack}
          onSuccess={() => {
            onPageChange("welcome");
            onContinue();
          }}
          providers={providerConfigs ?? []}
          submitLabel="Next"
        />
      </OnboardingScreen>
    );
  }

  return (
    <OnboardingScreen
      footer={
        !instrumentOnly && (
          <Button
            className="text-foreground/40 hover:bg-transparent hover:text-foreground/60"
            onClick={
              onAddProvider ??
              (() => {
                onPageChange("add-provider");
              })
            }
            size="xs"
            type="button"
            variant="ghost"
          >
            Or add an AI provider manually
          </Button>
        )
      }
    >
      <div className="flex w-full flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-6">
          <BrandMark className="size-20 drop-shadow-md" />

          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="font-serif text-3xl font-medium tracking-tight text-foreground">
              {signedIn
                ? "Add an AI provider"
                : (heading?.title ?? `Log in to ${APP_NAME}`)}
            </h1>
            <p className="text-sm text-foreground/80">
              {signedIn
                ? offersClaude
                  ? "Use the ChatGPT, Claude or Grok plan you already pay for."
                  : "Use the ChatGPT or Grok plan you already pay for."
                : (heading?.subtitle ??
                  `${APP_NAME} is a desktop app for doing your best work with AI. It works in your files and its own browser, and connects with all your favorite apps.`)}
            </p>
          </div>
        </div>

        <div className="flex w-full max-w-xs flex-col items-center gap-4">
          {!signedIn && shows("instrument") && (
            <ConnectButton
              caption={
                instrument.isTrial && (
                  <p className="text-center text-xs leading-4.5 text-muted-foreground">
                    {instrument.line}
                  </p>
                )
              }
              className="w-full justify-center"
              onResult={landed}
              onWaitingChange={holdingChange("instrument")}
              provider="instrument"
              variant="default"
            />
          )}

          {!instrumentOnly && (
            <>
              {shows("chatgpt") && (
                <ConnectButton
                  caption="Pay for ChatGPT Plus or Pro? Use it here."
                  className="w-full justify-center"
                  onResult={landed}
                  onWaitingChange={holdingChange("chatgpt")}
                  provider="chatgpt"
                />
              )}

              {offersClaude && shows("claude") && (
                <ConnectButton
                  caption="Pay for Claude Pro or Max? Use it here."
                  className="w-full justify-center"
                  onResult={landed}
                  onWaitingChange={holdingChange("claude")}
                  provider="claude"
                />
              )}

              {shows("grok") && (
                <ConnectButton
                  caption="Pay for SuperGrok or X Premium+? Use it here."
                  className="w-full justify-center"
                  onResult={landed}
                  onWaitingChange={holdingChange("grok")}
                  provider="grok"
                />
              )}
            </>
          )}

          <TermsFooter />
        </div>
      </div>
    </OnboardingScreen>
  );
}
