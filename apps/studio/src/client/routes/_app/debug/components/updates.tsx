import { UpdateReminderBanner } from "@/client/components/update-reminder";
import { UpdateRequiredScreen } from "@/client/components/update-required-screen";
import { MANUAL_DOWNLOAD_URL } from "@instrument-org/shared";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/debug/components/updates")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug Updates" }],
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
          <h1 className="text-2xl font-semibold tracking-tight">Updates</h1>
          <p className="text-sm text-muted-foreground">
            Escalation surfaces for the app updater. Use the dev panel&apos;s
            Updates menu to trigger the real, chrome-level versions.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">Update reminder banner</h2>
            <p className="text-sm text-muted-foreground">
              Shown under the toolbar once a downloaded update has been ignored
              past the server threshold.
            </p>
          </div>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-xs text-muted-foreground">
                with version
              </p>
              <div className="overflow-hidden rounded-lg border border-border">
                <UpdateReminderBanner
                  onDismiss={() => toast.info("onDismiss")}
                  onRestart={() => toast.info("onRestart")}
                  version="1.2.3"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-mono text-xs text-muted-foreground">
                without version
              </p>
              <div className="overflow-hidden rounded-lg border border-border">
                <UpdateReminderBanner
                  onDismiss={() => toast.info("onDismiss")}
                  onRestart={() => toast.info("onRestart")}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">Update required screen</h2>
            <p className="text-sm text-muted-foreground">
              Replaces the entire chrome when the build is below the
              server&apos;s minimum supported version. The action buttons
              reflect the live updater state.
            </p>
          </div>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-xs text-muted-foreground">
                default message
              </p>
              <div className="h-100 overflow-hidden rounded-lg border border-border">
                <UpdateRequiredScreen
                  downloadUrl={MANUAL_DOWNLOAD_URL}
                  showWindowChrome={false}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-mono text-xs text-muted-foreground">
                server-provided message
              </p>
              <div className="h-100 overflow-hidden rounded-lg border border-border">
                <UpdateRequiredScreen
                  downloadUrl={MANUAL_DOWNLOAD_URL}
                  message="This build has a known issue with task sync. Please update to keep your tasks safe."
                  showWindowChrome={false}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
