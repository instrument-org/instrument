import { ContactErrorAlert } from "@/client/components/contact-error-alert";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "@/client/lib/toast";

export const Route = createFileRoute("/debug/components/alerts")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug alerts" }],
  }),
});

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
