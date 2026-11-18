import { Button } from "@/client/components/ui/button";
import { toast } from "@/client/lib/toast";

import { DebugState } from "../-shell";
import { type NoticesStateId, noticesStatesOn } from "../-states/notices";

const noop = () => {
  // Shown for its button only.
};

// Each one is a toast the app really shows, with its own words.
const examples = {
  "brief-toast": {
    note: "One line, gone after a few seconds.",
    show: () => toast("Copied the question"),
  },
  "developer-toast": {
    note: "Shows only in developer mode, marked so nobody mistakes it for one people see.",
    show: () => toast.dev("Developer mode is off"),
  },
  "error-toast": {
    note: "Stays until it's closed. In developer mode the error's own text shows under it.",
    show: () =>
      toast.error("Couldn't open the file", {
        cause: new Error("ENOENT: no such file or directory, open 'notes.md'"),
      }),
  },
  "error-toast-action": {
    note: "The way to fix it is a button on the toast.",
    show: () =>
      toast.error("Couldn't install the update", {
        action: { label: "Open Settings", onClick: noop },
        cause: new Error("Code signature did not match"),
      }),
  },
  "info-toast": {
    note: "Why something didn't happen yet, and what to do.",
    show: () =>
      toast.info("Models are still loading", {
        description: "Try sending again in a moment.",
      }),
  },
  "message-toast": {
    note: "Something happened that the person should know about.",
    show: () =>
      toast.message("Merged the agent's edit with yours", {
        description:
          "You and the agent changed the same lines, and both edits were kept.",
      }),
  },
  "success-toast": {
    note: "Done, with a second line saying what changed.",
    show: () =>
      toast.success("Connected your Claude account", {
        description: "Its models are in the model picker.",
      }),
  },
} satisfies Record<
  NoticesStateId<"toasts">,
  { note: string; show: () => void }
>;

export function Toasts() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
      <p className="text-sm text-muted-foreground">
        Toasts appear in the bottom-left corner. Each button here shows one the
        app really sends.
      </p>
      <div className="flex flex-col gap-4">
        {noticesStatesOn("toasts").map((state) => {
          const example = examples[state.id];
          return (
            <DebugState id={state.id} key={state.id}>
              <section className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">{state.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {example.note}
                  </p>
                </div>
                <Button onClick={example.show} size="sm" variant="outline">
                  Show
                </Button>
              </section>
            </DebugState>
          );
        })}
      </div>
    </div>
  );
}
