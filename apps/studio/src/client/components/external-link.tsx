import { useOpenDestinations } from "@/client/hooks/use-open-target";
import { cn } from "@/client/lib/utils";

import { TaskExternalLink } from "./task-external-link";

export function ExternalLink(
  props: React.ComponentProps<"a"> & {
    addReferral?: boolean;
  },
) {
  const { addReferral = true, className, href, onClick, ...rest } = props;
  const destinations = useOpenDestinations(
    { kind: "page", url: href ?? "" },
    { addReferral },
  );
  // Somewhere in the app this page could go, as opposed to the OS browser
  // being the whole of the answer. What decides it is the surface -- a window
  // with tabs, a task with a browser -- rather than which provider happens to
  // be overhead, which is what left a link in a Markdown file leaving the app
  // while the same link in a reply asked.
  const opensInApp = destinations.some(
    (destination) =>
      destination.id !== "copy" && destination.id !== "openBrowser",
  );

  // Where a page has two places it could go, which one is wanted follows from
  // what the reader is doing at that moment rather than from a setting picked
  // once, so the click asks. Where it has one, the click is the answer.
  if (href && opensInApp) {
    return (
      <TaskExternalLink
        {...rest}
        addReferral={addReferral}
        className={className}
        href={href}
        onClick={onClick}
      />
    );
  }

  return (
    // eslint-disable-next-line no-restricted-syntax
    <a
      {...rest}
      className={cn("cursor-pointer!", className)}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        destinations[0]?.run();
        onClick?.(event);
      }}
    />
  );
}
