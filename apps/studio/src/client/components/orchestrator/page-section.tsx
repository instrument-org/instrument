import { type ReactNode } from "react";

/**
 * A section of a start page: what it is called, in the quiet weight the page
 * reads its heads in, and beside it the one way to the rest of what it holds.
 */
export function PageSection({
  action,
  children,
  title,
}: {
  action?: { icon: ReactNode; label: string; onOpen: () => void };
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <div className="flex h-8 items-center justify-between">
        <h2 className="text-lg font-medium text-muted-foreground">{title}</h2>
        {action ? (
          <button
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm text-muted-foreground shadow-xs hover:text-foreground"
            onClick={action.onOpen}
            type="button"
          >
            {action.icon}
            {action.label}
          </button>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
