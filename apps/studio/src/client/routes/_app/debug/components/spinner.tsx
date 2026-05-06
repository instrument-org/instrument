import { Spinner } from "@/client/components/ui/spinner";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/debug/components/spinner")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug Spinner" }],
  }),
});

const sizes: { className: string; label: string }[] = [
  { className: "size-4", label: "Small (16px)" },
  { className: "size-6", label: "Medium (24px)" },
  { className: "size-10", label: "Large (40px)" },
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
            Ring spinner shown during loading states.
          </p>
        </header>

        <div className="flex flex-col gap-10">
          {sizes.map((s) => (
            <section className="flex flex-col gap-3" key={s.label}>
              <p className="text-sm font-medium">{s.label}</p>
              <Spinner className={s.className} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
