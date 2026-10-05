import { type ReactNode } from "react";

/**
 * A shelf of a start page, labeled with a quiet name on a hairline that
 * runs out to the column's edge. The browser's starting view and the Apps
 * place both read their heads in it, so recent pages are headed the same
 * wherever they are listed.
 *
 * An action, when there is one, waits at the hairline's end and shows only
 * while the head is under the pointer or the action has the keyboard, so a
 * shelf at rest, and one whose pages are being pressed, is its name and its
 * line and nothing more.
 */
export function PageSection({
  action,
  children,
  title,
}: {
  action?: { icon: ReactNode; label: string; onPress: () => void };
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      {/* The head's own band, a little taller than its line for the pointer
          to find without moving anything around it. */}
      <div className="group/head -my-2 flex h-10 items-center gap-3">
        <h2 className="shrink-0 text-[13px] font-medium text-muted-foreground">
          {title}
        </h2>
        <span aria-hidden className="h-px flex-1 bg-border" />
        {action ? (
          // No width at rest, so the line runs out to the edge, and opened
          // under the pointer, the line drawing back to make room.
          <div className="-ml-3 flex max-w-0 shrink-0 justify-end overflow-hidden opacity-0 transition-[max-width,opacity] duration-200 group-hover/head:max-w-32 group-hover/head:opacity-100 has-focus-visible:max-w-32 has-focus-visible:opacity-100">
            <button
              className="ml-3 inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] whitespace-nowrap text-muted-foreground/70 hover:bg-accent/60 hover:text-muted-foreground"
              onClick={action.onPress}
              type="button"
            >
              {action.icon}
              {action.label}
            </button>
          </div>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
