import { Button } from "@/client/components/ui/button";
import { toast } from "@/client/lib/toast";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/toasts")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug toasts" }],
  }),
});

const noop = () => {
  // Shown for its button only.
};

// Each one is a toast the app really shows, with its own words.
const examples: { label: string; note: string; show: () => void }[] = [
  {
    label: "Brief",
    note: "One line, gone after a few seconds.",
    show: () => toast("Copied the question"),
  },
  {
    label: "Success",
    note: "Done, with a second line saying what changed.",
    show: () =>
      toast.success("Connected your Claude account", {
        description: "Its models are in the model picker.",
      }),
  },
  {
    label: "Info",
    note: "Why something didn't happen yet, and what to do.",
    show: () =>
      toast.info("Models are still loading", {
        description: "Try sending again in a moment.",
      }),
  },
  {
    label: "Message",
    note: "Something happened that the person should know about.",
    show: () =>
      toast.message("Merged the agent's edit with yours", {
        description:
          "You and the agent changed the same lines, and both edits were kept.",
      }),
  },
  {
    label: "Error",
    note: "Stays until it's closed. In developer mode the error's own text shows under it.",
    show: () =>
      toast.error("Couldn't open the file", {
        cause: new Error("ENOENT: no such file or directory, open 'notes.md'"),
      }),
  },
  {
    label: "Error with an action",
    note: "The way to fix it is a button on the toast.",
    show: () =>
      toast.error("Couldn't install the update", {
        action: { label: "Open Settings", onClick: noop },
        cause: new Error("Code signature did not match"),
      }),
  },
  {
    label: "Developer",
    note: "Shows only in developer mode, marked so nobody mistakes it for one people see.",
    show: () => toast.dev("Developer mode is off"),
  },
];

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Components
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Toasts</h1>
          <p className="text-sm text-muted-foreground">
            Toasts appear in the bottom-left corner. Each button here shows one
            the app really sends.
          </p>
        </header>

        <div className="flex flex-col gap-4">
          {examples.map((example) => (
            <section
              className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4"
              key={example.label}
            >
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">{example.label}</p>
                <p className="text-xs text-muted-foreground">{example.note}</p>
              </div>
              <Button onClick={example.show} size="sm" variant="outline">
                Show
              </Button>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
