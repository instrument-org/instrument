import { skillHref } from "@/client/components/window/tab-location";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { type ReactNode } from "react";

/**
 * A way to a skill's page from wherever a skill is named: the token of a
 * mention, the row of a skill-changes card.
 *
 * The window's own openers take the skill's address to Settings, open on the
 * skill, and a middle click or a right click get the gestures every opener
 * there answers. A transcript drawn where nothing can be opened (the debug
 * pages) shows the name alone.
 */
export function SkillLink({
  name,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** The name the skill's page is looked up by. */
  name: string;
  tabIndex?: number;
}) {
  return <ScreenLink href={skillHref(name)} {...rest} />;
}

/** The same way to any screen of the window's, by its address. */
export function ScreenLink({
  children,
  className,
  href,
  tabIndex,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  tabIndex?: number;
}) {
  const gestures = useOpenGestures({ href, kind: "screen" });
  const open = gestures.destinations.find((entry) => entry.id === "open");
  if (open) {
    return (
      <button
        className={className}
        onAuxClick={gestures.onAuxClick}
        onClick={open.run}
        onContextMenu={gestures.onContextMenu}
        tabIndex={tabIndex}
        type="button"
      >
        {children}
      </button>
    );
  }
  return <span className={className}>{children}</span>;
}
