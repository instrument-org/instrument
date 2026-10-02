import { useImageArrival } from "@/client/hooks/use-image-arrival";
import {
  getFaviconUrl,
  isIconlessThisSession,
  markIconlessThisSession,
} from "@/client/lib/favicon-url";
import { cn } from "@/client/lib/utils";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { type ReactNode, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The lift under a favicon, for the theme that needs one.
 *
 * An icon is authored for the light chrome a browser draws it in, so it sits
 * on a light page exactly as its author meant and wants nothing from us
 * there. On a dark page the same icon is on a ground it was never drawn for,
 * and a faint tile under it separates the mark from the page and gives the
 * ones carrying a dark background of their own an edge.
 *
 * Faint on purpose. This used to be a near-white plate with a ring, which did
 * make the rare dark-ink-on-transparent icon legible and made every other
 * icon in dark mode look like a sticker. That trade is the wrong way round:
 * most icons carry their own color and need nothing, so the tile lifts them
 * all a little rather than rescuing a few at the cost of the rest. An icon
 * that is dark ink on nothing is dim in dark mode, the way it is in any other
 * dark chrome that draws it.
 */
export const FAVICON_SURFACE_CLASS_NAME = "dark:bg-white/10";

export function Favicon({
  className,
  fallback,
  onNone,
  url,
}: {
  className?: string;
  /** What to draw when the site has no icon anywhere; the drawn globe otherwise. */
  fallback?: ReactNode;
  /** Told once the site turns out to have no icon anywhere, for a caller that would rather draw nothing than a globe. */
  onNone?: () => void;
  url: string;
}) {
  const hostname = URL.canParse(url) ? new URL(url).hostname : url;
  // A site with no icon gets a drawn globe rather than a bitmap one scaled up,
  // and one already found to have none this session draws it at once.
  const [isIconless, setIconless] = useState(() => isIconlessThisSession(url));
  const faviconUrl = getFaviconUrl(url);
  // Taken apart here: what goes to the element's ref is a ref to the lint,
  // and the class beside it is read in render.
  const {
    attach,
    className: arrivalClassName,
    onLoad: arrived,
  } = useImageArrival(faviconUrl, "icon");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {isIconless ? (
          (fallback ?? (
            <GlobeIcon
              aria-label={`Favicon for ${hostname}`}
              className={cn("size-4 shrink-0 text-muted-foreground", className)}
              role="img"
            />
          ))
        ) : (
          <img
            alt={`Favicon for ${hostname}`}
            className={cn(
              // A rounded rectangle, the way a browser tab softens a site's
              // own square mark, and what tells a site from an app's circle.
              "size-4 shrink-0 rounded-sm border border-border/50",
              FAVICON_SURFACE_CLASS_NAME,
              arrivalClassName,
              className,
            )}
            onError={() => {
              markIconlessThisSession(url);
              setIconless(true);
              onNone?.();
            }}
            onLoad={arrived}
            ref={attach}
            src={faviconUrl}
          />
        )}
      </TooltipTrigger>
      <TooltipContent>{hostname}</TooltipContent>
    </Tooltip>
  );
}
