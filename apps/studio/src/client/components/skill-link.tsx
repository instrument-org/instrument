import { InternalLink } from "@/client/components/internal-link";
import { SKILLS_HREF } from "@/client/components/orchestrator/tab-location";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { type ReactNode } from "react";

/**
 * A way to a skill's page from wherever a skill is named: the token of a
 * mention, the row of a skill-changes card.
 *
 * Where the link is drawn decides where the page opens. In the 2.0 window the
 * skill is a screen of the pane, so the link opens it as a tab of the thread
 * through the window's own openers, and a middle click or a right click get
 * the gestures every opener there answers. Outside it, the skill's page is a
 * route of the classic window and the link is the tab-aware one every route
 * is reached by. The two are told apart by whether the window offers a way to
 * open a screen at all, so a transcript shown outside either window draws the
 * classic link and nothing about the 2.0 window leaks into it.
 */
export function SkillLink({
  children,
  className,
  name,
  openInCurrentTab = false,
  tabIndex,
}: {
  children: ReactNode;
  className?: string;
  /** The name the skill's page is looked up by, as either route takes it. */
  name: string;
  /** In the classic window, whether the page takes over the tab rather than opening beside it. */
  openInCurrentTab?: boolean;
  tabIndex?: number;
}) {
  const gestures = useOpenGestures({
    href: `${SKILLS_HREF}/${name}`,
    kind: "screen",
  });
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
  return (
    <InternalLink
      className={className}
      openInCurrentTab={openInCurrentTab}
      params={{ name }}
      tabIndex={tabIndex}
      to="/skills/$name"
    >
      {children}
    </InternalLink>
  );
}
