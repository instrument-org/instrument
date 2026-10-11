import { ContactErrorAlert } from "@/client/components/contact-error-alert";
import {
  type UpgradeSubscriptionAlertState,
  UpgradeSubscriptionAlertView,
} from "@/client/components/upgrade-subscription-alert";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "@/client/lib/toast";

export const Route = createFileRoute("/debug/components/alerts")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug alerts" }],
  }),
});

const upgradeStates: {
  description: string;
  label: string;
  loggingIn?: boolean;
  state: UpgradeSubscriptionAlertState;
}[] = [
  {
    description:
      "The person has no credits left, so the only way forward is to contact support.",
    label: "out-of-credits",
    state: "out-of-credits",
  },
  {
    description:
      "The person has credits again, after adding some or waiting for them to reset.",
    label: "credits-available",
    state: "credits-available",
  },
  {
    description: "The person is logged out of Instrument.",
    label: "logged-out",
    state: "logged-out",
  },
  {
    description:
      "The person pressed Log in, and the app is waiting for them to finish in the browser.",
    label: "logged-out, logging in",
    loggingIn: true,
    state: "logged-out",
  },
  {
    description: "The app couldn't load the person's subscription.",
    label: "status-error",
    state: "status-error",
  },
  {
    description: "The app is still loading the person's subscription.",
    label: "loading",
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
            Alerts that only show up when something goes wrong with an account,
            which is hard to set up in a real session.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">Upgrade / credit alert</h2>
            <p className="text-sm text-muted-foreground">
              A chat shows this in place of its error when a turn fails because
              the person ran out of credits.
            </p>
          </div>
          <div className="flex flex-col gap-6">
            {upgradeStates.map(({ description, label, loggingIn, state }) => (
              <div className="flex flex-col gap-2" key={label}>
                <div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {label}
                  </p>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
                <UpgradeSubscriptionAlertView
                  loggingIn={loggingIn}
                  onCancelLogin={() => toast.info("onCancelLogin")}
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
            <h2 className="text-base font-semibold">Contact error alert</h2>
            <p className="text-sm text-muted-foreground">
              Settings shows this under your account when it can&apos;t reach
              the server to load it.
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
          </div>
        </section>
      </div>
    </div>
  );
}
