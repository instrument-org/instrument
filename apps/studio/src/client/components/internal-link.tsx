import { useAppTabs } from "@/client/components/window/app-tabs";
import { WindowContext } from "@/client/components/window/context";
import { wantsNewWindow } from "@/client/hooks/use-open-target";
// The one place TanStack Router's Link belongs: this is the tab-aware wrapper
// every other call site is pointed at.
// oxlint-disable-next-line studio/no-router-link
import { Link, type LinkProps, useRouter } from "@tanstack/react-router";
import { type MouseEvent, useContext } from "react";
import { commandKeyHeld } from "@/client/lib/utils";

/**
 * A link to a route: a click moves the tab it is in, a middle click or a
 * Cmd/Ctrl click opens the route in a tab of its own, behind the one up for
 * a middle click, and a Shift click opens it in a window of its own. In the
 * app window that tab is one of the group's, beside the one up.
 */
export function InternalLink(
  props: LinkProps & {
    className?: string;
    onAuxClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onDoubleClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onMouseDown?: (e: MouseEvent<HTMLAnchorElement>) => void;
    tabIndex?: number;
  },
) {
  const appTabs = useAppTabs();
  const appWindow = useContext(WindowContext);
  const router = useRouter();
  const {
    onAuxClick,
    onClick,
    onDoubleClick,
    onMouseDown,
    params,
    search,
    target,
    to,
    ...rest
  } = props;

  const hrefOfLink = () =>
    // Cast because `LinkProps` leaves its route unresolved, which the
    // location builder's generics cannot take back.
    router.buildLocation({
      params,
      search,
      to,
    } as Parameters<typeof router.buildLocation>[0]).href;
  const openInNewTab = (select: boolean) => {
    if (appWindow) {
      appWindow.openScreen(hrefOfLink(), { behind: !select, newTab: true });
    } else {
      appTabs.open(hrefOfLink(), { newTab: true, select });
    }
  };

  const handleMouseDown = (e: MouseEvent<HTMLAnchorElement>) => {
    // Prevent default for middle clicks to avoid opening in system browser
    if (e.button === 1) {
      e.preventDefault();
    }
    if (onMouseDown) {
      onMouseDown(e);
    }
  };

  const handleAuxClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Handle middle click via auxclick event (more reliable for some browsers)
    if (e.button === 1) {
      e.preventDefault();
      openInNewTab(false);
    }
    if (onAuxClick) {
      onAuxClick(e);
    }
  };

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button === 0 && (wantsNewWindow(e) || commandKeyHeld(e))) {
      e.preventDefault();
      openInNewTab(true);
    }
    if (onClick) {
      onClick(e);
    }
  };

  return (
    <Link
      {...rest}
      draggable={false}
      onAuxClick={handleAuxClick}
      onClick={handleClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={handleMouseDown}
      params={params}
      search={search}
      target={target}
      to={to}
    />
  );
}
