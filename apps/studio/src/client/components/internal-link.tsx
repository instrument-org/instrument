import { useAppTabs } from "@/client/components/window/app-tabs";
// The one place TanStack Router's Link belongs: this is the tab-aware wrapper
// every other call site is pointed at.
// oxlint-disable-next-line studio/no-router-link
import { Link, type LinkProps, useRouter } from "@tanstack/react-router";
import { type MouseEvent } from "react";

/**
 * A link to a route: a click moves the tab it is in, and a middle click or a
 * Cmd/Ctrl click opens the route in a tab of its own, behind the one up for
 * a middle click.
 */
export function InternalLink(
  props: LinkProps & {
    allowOpenNewTab?: boolean;
    className?: string;
    onAuxClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onDoubleClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onMouseDown?: (e: MouseEvent<HTMLAnchorElement>) => void;
    tabIndex?: number;
  },
) {
  const appTabs = useAppTabs();
  const router = useRouter();
  const {
    allowOpenNewTab = true,
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

  const openInNewTab = (select: boolean) => {
    // Cast because `LinkProps` leaves its route unresolved, which the
    // location builder's generics cannot take back.
    const { href } = router.buildLocation({
      params,
      search,
      to,
    } as Parameters<typeof router.buildLocation>[0]);
    appTabs.open(href, { select });
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
      if (allowOpenNewTab) {
        openInNewTab(false);
      }
    }
    if (onAuxClick) {
      onAuxClick(e);
    }
  };

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button === 0 && (e.ctrlKey || e.metaKey) && allowOpenNewTab) {
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
