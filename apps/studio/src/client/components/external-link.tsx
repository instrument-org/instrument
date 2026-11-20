import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn } from "@/client/lib/utils";

/**
 * A link to a page, answering the gestures every openable thing answers.
 *
 * A click opens the page in the app wherever the surface has a place for it
 * (the tab or the chat it was clicked in), and in the OS browser where the
 * surface has none (setup, a dialog); with `target="_blank"`, in a new tab
 * in front right after the tab it is in. A middle or Cmd-click opens a tab of
 * its own; a right click offers the rest, the OS browser included. The anchor
 * keeps its href so the URL is inspectable and copyable; the navigation it
 * would do belongs to the gestures.
 */
export function ExternalLink(
  props: React.ComponentProps<"a"> & {
    addReferral?: boolean;
  },
) {
  const { addReferral = true, className, href, onClick, ...rest } = props;
  const gestures = useOpenGestures(
    { kind: "page", url: href ?? "" },
    { addReferral, isLink: true, opensNewTab: rest.target === "_blank" },
  );

  return (
    // oxlint-disable-next-line studio/no-raw-anchor
    <a
      {...rest}
      className={cn("cursor-pointer!", className)}
      href={href}
      onAuxClick={gestures.onAuxClick}
      onClick={(event) => {
        gestures.onClick(event);
        onClick?.(event);
      }}
      onContextMenu={gestures.onContextMenu}
    />
  );
}
