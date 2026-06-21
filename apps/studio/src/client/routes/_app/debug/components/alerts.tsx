import { ContactErrorAlert } from "@/client/components/contact-error-alert";
import {
  type UpgradeSubscriptionAlertState,
  UpgradeSubscriptionAlertView,
} from "@/client/components/upgrade-subscription-alert";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/debug/components/alerts")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug Alerts" }],
  }),
});

const upgradeStates: {
  description: string;
  state: UpgradeSubscriptionAlertState;
}[] = [
  {
    description: "User has credits — shown after purchasing/waiting for reset.",
    state: "credits-available",
  },
  {
    description: "The critical state: no credits left, must contact support.",
    state: "out-of-credits",
  },
  {
    description: "Not logged in — shown when there is no auth token.",
    state: "logged-out",
  },
  {
    description: "Subscription status RPC failed.",
    state: "status-error",
  },
  {
    description: "Waiting for subscription status to load.",
    state: "loading",
  },
];

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Components
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            Special-case alert states that are hard to reproduce in a real
            session.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">Upgrade / Credit Alert</h2>
            <p className="text-sm text-muted-foreground">
              Shown inline in the chat when a session fails due to credits.
            </p>
          </div>
          <div className="flex flex-col gap-6">
            {upgradeStates.map(({ description, state }) => (
              <div className="flex flex-col gap-2" key={state}>
                <div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {state}
                  </p>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
                <UpgradeSubscriptionAlertView
                  onContinue={() => toast.info("onContinue")}
                  onLogin={() => toast.info("onLogin")}
                  state={state}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">Contact Error Alert</h2>
            <p className="text-sm text-muted-foreground">
              Shown when an operation fails and the user may need support.
            </p>
          </div>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <div>
                <p className="font-mono text-xs text-muted-foreground">
                  with retry
                </p>
              </div>
              <ContactErrorAlert
                onRetry={() => toast.info("onRetry")}
                title="Connection error"
              >
                Could not connect to the workspace server.
              </ContactErrorAlert>
            </div>
            <div className="flex flex-col gap-2">
              <div>
                <p className="font-mono text-xs text-muted-foreground">
                  without retry
                </p>
              </div>
              <ContactErrorAlert title="Something went wrong">
                An unexpected error occurred while loading your data.
              </ContactErrorAlert>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
