import { AppIconStylized } from "@/client/components/app-icon-stylized";
import { ExternalLink } from "@/client/components/external-link";
import { GoogleSignInButton } from "@/client/components/google-sign-in-button";
import { TermsFooter } from "@/client/components/terms-footer";
import { Button } from "@/client/components/ui/button";
import { APP_NAME, SUPPORT_URL } from "@instrument-org/shared";
import { WarningCircleIcon } from "@phosphor-icons/react";

export function OnboardingWelcomeScreen({
  error,
  isSetupComplete,
  onAddProvider,
  onContinue,
}: {
  error?: Error | null;
  isSetupComplete: boolean;
  onAddProvider?: () => void;
  onContinue?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-between overflow-hidden px-6 pt-20 pb-6">
      <div className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-6">
          <AppIconStylized className="size-20" />

          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="font-serif text-3xl font-medium tracking-tight text-foreground">
              {isSetupComplete
                ? `Welcome to ${APP_NAME}`
                : `Sign in to ${APP_NAME}`}
            </h1>
            <p className="text-sm text-foreground/80">
              {isSetupComplete
                ? "Let's begin."
                : "A guided AI workspace for ambitious work"}
            </p>
          </div>
        </div>

        <div className="flex w-full max-w-xs flex-col items-center gap-2.5">
          {isSetupComplete ? (
            <Button onClick={onContinue} type="button" variant="default">
              Continue
            </Button>
          ) : (
            <>
              {error && (
                <div className="w-full rounded-lg bg-muted px-3 py-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <WarningCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground/80">
                      Sign in failed
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    There was an error signing in. Please try again, or{" "}
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

              <GoogleSignInButton className="w-full justify-center" />

              <Button
                className="w-full justify-center bg-white/30 text-foreground/70
                  hover:bg-white/40 dark:bg-white/5 dark:hover:bg-white/10"
                onClick={onAddProvider}
                type="button"
                variant="ghost"
              >
                Or add an AI provider manually
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-end [-webkit-app-region:drag]">
        {!isSetupComplete && <TermsFooter />}
      </div>
    </div>
  );
}
