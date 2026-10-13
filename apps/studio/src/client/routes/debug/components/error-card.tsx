import { AppErrorFallback } from "@/client/components/app-error-fallback";
import { ErrorCard } from "@/client/components/error-card";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/error-card")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug error card" }],
  }),
});

const simpleError = new Error("Something went wrong while loading your data.");

const errorWithCode = Object.assign(
  new Error("The request could not be authenticated."),
  { code: "UNAUTHORIZED" },
);

const errorWithCause = Object.assign(
  new Error("Failed to connect to the workspace server."),
  { cause: new Error("ECONNREFUSED 127.0.0.1:4000") },
);

const variants: { description?: string; error: unknown; title: string }[] = [
  {
    error: simpleError,
    title: "Simple error",
  },
  {
    error: errorWithCode,
    title: "Error with code",
  },
  {
    error: errorWithCause,
    title: "Error with cause",
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
          <h1 className="text-2xl font-semibold tracking-tight">Error card</h1>
          <p className="text-sm text-muted-foreground">
            A screen shows this card in its place when it fails to load. Every
            error carries its stack trace under a toggle.
          </p>
        </header>

        <div className="flex flex-col gap-10">
          {variants.map((v) => (
            <section className="flex flex-col gap-3" key={v.title}>
              <div>
                <p className="text-sm font-medium">{v.title}</p>
                {v.description && (
                  <p className="text-xs text-muted-foreground">
                    {v.description}
                  </p>
                )}
              </div>
              <ErrorCard error={v.error} />
            </section>
          ))}
          <section className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium">Window crash</p>
              <p className="text-xs text-muted-foreground">
                The whole app window shows this when it crashes, and reloading
                is the only way back.
              </p>
            </div>
            <AppErrorFallback error={simpleError} />
          </section>
        </div>
      </div>
    </div>
  );
}
