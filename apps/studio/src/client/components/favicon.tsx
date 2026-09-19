import { useImageArrival } from "@/client/hooks/use-image-arrival";
import { getFaviconUrl } from "@/client/lib/favicon-url";
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

/**
 * The widest image the proxy sends when it has no icon for a site: a 16px
 * globe of its own, under a 404 an `<img>` draws anyway. The proxy is asked
 * for 64 and answers with what the site has, 32 or 64 for a real icon, so an
 * answer this small is its stand-in and not the site's.
 */
const PROXY_STAND_IN_MAX_PX = 16;

/** Where the icon is being read from: the proxy, then the site itself, then nowhere. */
type Source = "none" | "proxy" | "site";

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
  // The proxy first, and the site's own icon when the proxy has none for it:
  // a site the proxy never fetched, or one behind a sign-in, still serves
  // its own. A site with none anywhere gets a drawn globe rather than a
  // bitmap one scaled up.
  const [source, setSource] = useState<Source>("proxy");
  const fallBack = () => {
    const next = source === "proxy" && URL.canParse(url) ? "site" : "none";
    setSource(next);
    if (next === "none") {
      onNone?.();
    }
  };
  const faviconUrl =
    source === "site"
      ? `${new URL(url).origin}/favicon.ico`
      : getFaviconUrl(url);
  const arrival = useImageArrival(faviconUrl, "icon");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {source === "none" ? (
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
              arrival.className,
              className,
            )}
            onError={fallBack}
            onLoad={(event) => {
              // A width of zero is an image with no size of its own (a vector
              // one, or a test's), which is not the proxy's globe.
              const { naturalWidth } = event.currentTarget;
              if (
                source === "proxy" &&
                naturalWidth > 0 &&
                naturalWidth <= PROXY_STAND_IN_MAX_PX
              ) {
                fallBack();
                return;
              }
              arrival.onLoad();
            }}
            src={faviconUrl}
          />
        )}
      </TooltipTrigger>
      <TooltipContent>{hostname}</TooltipContent>
    </Tooltip>
  );
}
