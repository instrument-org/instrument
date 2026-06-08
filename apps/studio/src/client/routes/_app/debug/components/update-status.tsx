import { UpdateStatusBadge } from "@/client/components/update-status-indicator";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/debug/components/update-status")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug Update Status" }],
  }),
});

const updateStates = [
  {
    description: "Active download with circular progress.",
    label: "Downloading 12%",
    state: { progress: 12, type: "downloading" },
  },
  {
    description: "Later download progress, same copy and stable layout.",
    label: "Downloading 68%",
    state: { progress: 68, type: "downloading" },
  },
  {
    description: "Update has been downloaded and can be installed.",
    label: "Ready",
    state: { type: "downloaded", version: "1.0.0-test" },
  },
  {
    description: "Install has started and the app may relaunch.",
    label: "Installing",
    state: { type: "installing" },
  },
  {
    description: "Updater failed. Clicking opens Settings in production.",
    label: "Error",
    state: {
      message: "There was an error checking for updates",
      type: "error",
    },
  },
] as const;

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Components
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Update Status
          </h1>
          <p className="text-sm text-muted-foreground">
            Titlebar update badge states shown without publishing updater
            events.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">Titlebar Context</h2>
            <p className="text-sm text-muted-foreground">
              Previewed inside a constrained toolbar-like row.
            </p>
          </div>
          <div className="flex h-10 items-center justify-end gap-2 rounded-lg border bg-background px-4">
            {updateStates.map(({ label, state }) => (
              <UpdateStatusBadge
                key={label}
                onClick={() => toast.info(label)}
                state={state}
              />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold">Individual States</h2>
            <p className="text-sm text-muted-foreground">
              Isolated rows for design review and screenshots.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {updateStates.map(({ description, label, state }) => (
              <div
                className="grid grid-cols-[9rem_1fr_auto] items-center gap-4 rounded-lg border bg-card px-4 py-3"
                key={label}
              >
                <p className="font-mono text-xs text-muted-foreground">
                  {label}
                </p>
                <p className="text-sm text-muted-foreground">{description}</p>
                <UpdateStatusBadge
                  onClick={() => toast.info(label)}
                  state={state}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
