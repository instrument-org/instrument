import { useImageArrival } from "@/client/hooks/use-image-arrival";
import {
  getFaviconUrl,
  markIconlessThisSession,
  useFaviconRetry,
  useIsIconlessThisSession,
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
  url,
}: {
  className?: string;
  /** What to draw when the site has no icon anywhere; the site's initial on a quiet tile otherwise. */
  fallback?: ReactNode;
  url: string;
}) {
  const hostname = URL.canParse(url) ? new URL(url).hostname : url;
  // A site with no icon gets its initial rather than a bitmap scaled up, and
  // one already found to have none this session draws it at once. Given an
  // icon later, it asks again.
  const isIconless = useIsIconlessThisSession(url);
  const retry = useFaviconRetry(url);
  const faviconUrl = getFaviconUrl(url, retry);
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
            <FaviconFallback className={className} label={hostname} />
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

/**
 * A site with no icon anywhere, as its initial on a quiet tile: the same
 * mark wherever the site is drawn, in the neutral of the chrome around it so
 * it reads as standing in for an icon rather than being one. The initial is
 * the host's, without its `www.`, so one site has one letter everywhere.
 */
export function FaviconFallback({
  className,
  label,
}: {
  className?: string;
  /** The site's host or address, which the letter is read from. */
  label: string;
}) {
  const host = (URL.canParse(label) ? new URL(label).hostname : label).replace(
    /^www\./,
    "",
  );
  const first = host.trim().codePointAt(0);
  // Drawn rather than laid out, so the letter scales with whatever box the
  // caller gives it, and a caller that sizes its icons by their svg sizes
  // this one too.
  return (
    <svg
      aria-label={`Favicon for ${host}`}
      className={cn("size-4 shrink-0", className)}
      role="img"
      viewBox="0 0 16 16"
    >
      <rect className="fill-foreground/10" height="16" rx="3" width="16" />
      <text
        className="fill-foreground/60 font-semibold select-none"
        dominantBaseline="central"
        fontSize="9.5"
        textAnchor="middle"
        x="8"
        y="8.5"
      >
        {first === undefined ? "" : String.fromCodePoint(first).toUpperCase()}
      </text>
    </svg>
  );
}

/**
 * A page's mark: the icon the page announced for itself where the renderer
 * may draw it (embedded bytes; a remote icon is refused by the page's
 * `img-src`), else its site's icon from the app's store, else the site's
 * initial. The one way every surface draws a site: tabs, rows, chips,
 * menus. A page with no web address (a fresh tab) has the globe.
 */
export function PageFavicon({
  className,
  favicon,
  url,
}: {
  className?: string;
  /** The icon the page last announced, when one is known. */
  favicon?: string | undefined;
  url: string | undefined;
}) {
  // An announced icon that does not load gives way to the site's.
  const [failed, setFailed] = useState<string | undefined>();
  if (favicon && failed !== favicon && /^(?:data|blob):/i.test(favicon)) {
    return (
      <img
        alt=""
        className={cn("size-4 shrink-0 rounded-sm", className)}
        draggable={false}
        onError={() => {
          setFailed(favicon);
        }}
        src={favicon}
      />
    );
  }
  if (url && /^https?:/i.test(url)) {
    return <Favicon className={className} url={url} />;
  }
  return (
    <GlobeIcon
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}
