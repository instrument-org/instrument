import { useTabActions } from "@/client/hooks/use-tab-actions";
import { isMouseClick } from "@/client/lib/immediate-click";
// The one place TanStack Router's Link belongs: this is the tab-aware wrapper
// every other call site is pointed at.
// eslint-disable-next-line no-restricted-syntax
import { Link, type LinkProps, useNavigate } from "@tanstack/react-router";
import { type MouseEvent, type PointerEvent } from "react";

export function InternalLink(
  props: LinkProps & {
    allowOpenNewTab?: boolean;
    className?: string;
    onAuxClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onDoubleClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onMouseDown?: (e: MouseEvent<HTMLAnchorElement>) => void;
    onPointerDown?: (e: PointerEvent<HTMLAnchorElement>) => void;
    openInCurrentTab?: boolean;
    openInNewTab?: boolean;
    tabIndex?: number;
  },
) {
  const { addTab, navigateTab } = useTabActions();
  const {
    allowOpenNewTab = true,
    onAuxClick,
    onClick,
    onDoubleClick,
    onMouseDown,
    onPointerDown,
    openInCurrentTab = false,
    openInNewTab = false,
    params,
    search,
    target,
    to,
    ...rest
  } = props;
  const navigate = useNavigate();

  const handleMouseDown = (e: MouseEvent<HTMLAnchorElement>) => {
    // Prevent default for middle clicks to avoid opening in system browser
    if (e.button === 1) {
      e.preventDefault();
    }
    if (onMouseDown) {
      onMouseDown(e);
    }
  };

  const performNavigation = (shouldOpenNewTab: boolean, selectTab = true) => {
    if (shouldOpenNewTab && allowOpenNewTab) {
      void addTab({ params, search, to }, { select: selectTab });
    } else if (openInCurrentTab) {
      void navigateTab({ params, search, to });
    } else {
      void navigate({ params, search, to });
    }
  };

  // Kept in one place so a consumer's `onClick` runs against the same event
  // that navigates, whichever path got there. Splitting them would let a
  // side effect land after a navigation it was meant to accompany.
  const activate = (e: MouseEvent<HTMLAnchorElement>, openNewTab: boolean) => {
    const shouldOpenNewTab = openNewTab || openInNewTab;
    performNavigation(shouldOpenNewTab, openInNewTab || !shouldOpenNewTab);
    onClick?.(e);
  };

  const handlePointerDown = (e: PointerEvent<HTMLAnchorElement>) => {
    onPointerDown?.(e);
    if (
      !e.defaultPrevented &&
      e.pointerType === "mouse" &&
      e.button === 0 &&
      !e.ctrlKey
    ) {
      activate(e, e.metaKey);
    }
  };

  const handleAuxClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Handle middle click via auxclick event (more reliable for some browsers)
    if (e.button === 1) {
      e.preventDefault();
      performNavigation(true, false);
    }
    if (onAuxClick) {
      onAuxClick(e);
    }
  };

  const handleDoubleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (onDoubleClick) {
      onDoubleClick(e);
    }
  };

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();

    // A real primary mouse click already navigated on press. What is left here
    // is keyboard and assistive activation, plus ctrl-click, which the press
    // path skips because macOS treats it as a context-menu gesture.
    if (e.button === 0 && (!isMouseClick(e) || e.ctrlKey)) {
      activate(e, e.ctrlKey || e.metaKey);
    }
  };

  return (
    <Link
      {...rest}
      draggable={false}
      onAuxClick={handleAuxClick}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onPointerDown={handlePointerDown}
      params={params}
      search={search}
      target={target}
      to={to}
    />
  );
}
