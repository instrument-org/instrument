import { AddProviderForm } from "@/client/components/add-provider/form";
import { BrandMark } from "@/client/components/brand-mark";
import { ChatGPTLoginButton } from "@/client/components/chatgpt-login-button";
import { ClaudeLoginButton } from "@/client/components/claude-login-button";
import { ExternalLink } from "@/client/components/external-link";
import { GoogleLoginButton } from "@/client/components/google-login-button";
import { BrandLeafIcon } from "@/client/components/icons/brand-leaf";
import { OnboardingScreen } from "@/client/components/onboarding/screen";
import { TermsFooter } from "@/client/components/terms-footer";
import { rpcClient } from "@/client/rpc/client";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import { APP_NAME, SUPPORT_URL } from "@instrument-org/shared";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "../ui/button";

export type ProviderSetupPage = "add-provider" | "welcome";

export function ProviderSetupScreen({
  error,
  heading,
  instrumentOnly,
  onAddProvider,
  onBack,
  onContinue,
  onLogin,
  onLoginSuccess,
  onPageChange,
  page,
  signedIn,
}: {
  error?: Error | null;
  /** In place of the sign-in page's own title and line under it, for a sign-in a feature asked for. */
  heading?: { subtitle: string; title: string };
  instrumentOnly?: boolean;
  onAddProvider?: () => void;
  onBack?: () => void;
  onContinue: () => void;
  onLogin: () => Promise<SignInOutcome>;
  onLoginSuccess: () => void;
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

  // The sign-in holding for the browser, which alone stays on the page until
  // it finishes or is canceled.
  const [holding, setHolding] = useState<"chatgpt" | "claude" | "google">();
  const holdingChange =
    (provider: "chatgpt" | "claude" | "google") => (waiting: boolean) => {
      setHolding((current) =>
        waiting ? provider : current === provider ? undefined : current,
      );
    };
  const shows = (provider: "chatgpt" | "claude" | "google") =>
    !holding || holding === provider;

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
                  ? "Use the ChatGPT or Claude plan you already pay for."
                  : "Use the ChatGPT plan you already pay for."
                : (heading?.subtitle ??
                  "A guided AI workspace for ambitious work")}
            </p>
          </div>
        </div>

        <div className="flex w-full max-w-xs flex-col items-center gap-4">
          {error && (
            <div className="w-full rounded-lg bg-muted px-3 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <WarningCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground/80">
                  Login failed
                </span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                There was an error logging in. Please try again, or{" "}
                <ExternalLink
                  className="underline underline-offset-2 hover:text-foreground"
                  href={SUPPORT_URL}
                >
                  contact support
                </ExternalLink>
                .
              </p>
            </div>
          )}

          {!signedIn && shows("google") && (
            <GoogleLoginButton
              caption={
                <div className="flex items-center justify-center gap-x-2">
                  <BrandLeafIcon className="size-3" />
                  <p className="text-xs leading-4.5 font-medium text-brand-600 dark:text-brand-400">
                    Create an account to get free AI usage
                  </p>
                </div>
              }
              className="w-full justify-center"
              onLogin={onLogin}
              onSuccess={onLoginSuccess}
              onWaitingChange={holdingChange("google")}
            />
          )}

          {!instrumentOnly && (
            <>
              {shows("chatgpt") && (
                <ChatGPTLoginButton
                  caption="Pay for ChatGPT Plus or Pro? Use it here."
                  className="w-full justify-center"
                  onSuccess={onLoginSuccess}
                  onWaitingChange={holdingChange("chatgpt")}
                />
              )}

              {offersClaude && shows("claude") && (
                <ClaudeLoginButton
                  caption="Pay for Claude Pro or Max? Use it here."
                  className="w-full justify-center"
                  onSuccess={onLoginSuccess}
                  onWaitingChange={holdingChange("claude")}
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
