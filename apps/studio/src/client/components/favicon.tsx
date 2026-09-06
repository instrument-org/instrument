import { useImageArrival } from "@/client/hooks/use-image-arrival";
import { getFaviconUrl } from "@/client/lib/favicon-url";
import { cn } from "@/client/lib/utils";
import { useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The surface a favicon is drawn on: a light one, whichever theme is on.
 *
 * An icon is authored for the light chrome a browser draws it in, so a good
 * share of them are dark ink on a transparent background. Left to sit on the
 * page in dark mode that ink is the page, and the link leads with a gap where
 * its icon should be. On a light surface every icon sits on the background it
 * was drawn against, and the theme stops deciding whether it can be seen.
 *
 * The ring is that same surface a pixel further out, for the icons that bring a
 * dark background of their own: those cover the plate entirely, and what would
 * otherwise be a black square on a near-black page keeps a light edge saying
 * where it ends. A ring rather than an inset because it is painted rather than
 * laid out, so the icon keeps every pixel of the box its caller sized.
 *
 * In light mode this is a shade under the page it replaces, so nothing there
 * changes. The mirror case does not need it to: an icon light enough to be
 * lost against a light page is one an author would have to have drawn for no
 * browser at all.
 */
export const FAVICON_SURFACE_CLASS_NAME = "bg-gray-100 ring-1 ring-gray-100";

export function Favicon({
  className,
  url,
}: {
  className?: string;
  url: string;
}) {
  const hostname = URL.canParse(url) ? new URL(url).hostname : url;
  // The proxy first, and the site's own icon when the proxy has none for it:
  // a site the proxy never fetched, or one behind a sign-in, still serves
  // its own.
  const [proxyFailed, setProxyFailed] = useState(false);
  const faviconUrl =
    proxyFailed && URL.canParse(url)
      ? `${new URL(url).origin}/favicon.ico`
      : getFaviconUrl(url);
  const arrival = useImageArrival(faviconUrl, "icon");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <img
          alt={`Favicon for ${hostname}`}
          className={cn(
            "size-4 shrink-0 rounded-full border border-border/50",
            FAVICON_SURFACE_CLASS_NAME,
            arrival.className,
            className,
          )}
          onError={() => {
            setProxyFailed(true);
          }}
          onLoad={arrival.onLoad}
          src={faviconUrl}
        />
      </TooltipTrigger>
      <TooltipContent>{hostname}</TooltipContent>
    </Tooltip>
  );
}
