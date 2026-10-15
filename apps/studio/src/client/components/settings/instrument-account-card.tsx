import { openLogin } from "@/client/atoms/login-modal";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";

/**
 * The way to Instrument's own AI at the top of the providers, while nobody is
 * logged in: Providers is where people look for a way to get AI working.
 * Logged in, the account and its plan are on the Account page instead.
 */
export function InstrumentAccountCard() {
  const { isSignedIn } = useBillingStatus();
  if (isSignedIn) {
    return null;
  }
  return (
    <Card className="gap-0 border-brand-200 bg-brand-50 p-4 dark:border-brand-500/30 dark:bg-brand-500/15">
      <div className="flex items-center gap-4">
        <div className="flex size-8 shrink-0 items-center justify-center">
          <AIProviderIcon colored type={OUR_MODELS.providerType} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="truncate font-medium text-foreground">
            {APP_NAME}&apos;s AI
          </h3>
          <p className="text-sm text-muted-foreground">
            Create an account to start a free trial, with no provider to set up.
          </p>
        </div>
        <Button
          className="shrink-0"
          onClick={() => {
            openLogin({ instrumentOnly: true });
          }}
          variant="brand"
        >
          Log in
        </Button>
      </div>
    </Card>
  );
}
