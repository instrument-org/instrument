import { Spinner } from "@/client/components/ui/spinner";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/spinner")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug spinner" }],
  }),
});

/** The sizes the app draws the spinner at. */
const sizes: { className: string; label: string; thickness?: number }[] = [
  { className: "size-3", label: "12px, in an extra-small button" },
  { className: "size-3.5", label: "14px, in a small button" },
  { className: "size-4", label: "16px, the default" },
  { className: "size-5", label: "20px" },
  { className: "size-6", label: "24px" },
  { className: "size-8", label: "32px, for a whole pane" },
  {
    className: "size-8 text-muted-foreground",
    label: "32px with a 1.5px ring, around the jump-to-latest button",
    thickness: 1.5,
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
          <h1 className="text-2xl font-semibold tracking-tight">Spinner</h1>
          <p className="text-sm text-muted-foreground">
            The ring the app turns while something loads. Most spinners wait a
            moment before they appear, so a quick load shows nothing. These all
            appear at once.
          </p>
        </header>

        <div className="flex flex-col gap-10">
          {sizes.map((s) => (
            <section className="flex flex-col gap-3" key={s.label}>
              <p className="text-sm font-medium">{s.label}</p>
              <Spinner
                className={s.className}
                delay={0}
                thickness={s.thickness}
              />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
