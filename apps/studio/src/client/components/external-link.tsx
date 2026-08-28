import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { useTaskSession } from "@/client/hooks/use-task-session";
import { cn } from "@/client/lib/utils";
import { useCallback } from "react";

import { TaskExternalLink } from "./task-external-link";

// Only a web page has two places it could go. `mailto:` and every other scheme
// the OS resolves to an app has exactly one, and offering the task's browser
// for those would be offering to open a page that does not exist.
const isWebPage = (href: string) => /^https?:\/\//i.test(href);

export function ExternalLink(
  props: React.ComponentProps<"a"> & {
    addReferral?: boolean;
  },
) {
  const { addReferral = true, className, href, onClick, ...rest } = props;

  const { sessionId, taskId } = useTaskSession();
  const openExternalLink = useOpenExternalLink();

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (href) {
        openExternalLink(href, { addReferral });
      }
      onClick?.(event);
    },
    [addReferral, onClick, openExternalLink, href],
  );

  // Inside a task a web page has two places it can go, and which one is wanted
  // follows from what the reader is doing at that moment rather than from a
  // setting picked once, so the click asks. Everywhere else in the app -- and
  // for anything that is not a web page -- there is only the one answer.
  if (href && taskId && sessionId && isWebPage(href)) {
    return (
      <TaskExternalLink
        {...rest}
        addReferral={addReferral}
        className={className}
        href={href}
        onClick={onClick}
        sessionId={sessionId}
        taskId={taskId}
      />
    );
  }

  return (
    // eslint-disable-next-line no-restricted-syntax
    <a
      {...rest}
      className={cn("cursor-pointer!", className)}
      href={href}
      onClick={handleClick}
    />
  );
}
