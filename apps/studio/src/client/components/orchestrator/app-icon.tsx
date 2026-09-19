import { Favicon } from "@/client/components/favicon";
import { cn } from "@/client/lib/utils";

import { TOPIC_COLORS } from "./topic-colors";

/**
 * An app's icon: the site's own favicon through the proxy, on a tile, so the
 * directory and the card and the sidebar all draw a service the same way.
 * With no site to ask, or a site with no icon anywhere, the app's initial on
 * a color of its own, so a service without a mark still has a face a person
 * can tell from the next one.
 */
export function AppIcon({
  className,
  name,
  site,
  size = "md",
}: {
  className?: string;
  /** What the app is called, which its initial and its color come from; the site's host stands in without it. */
  name?: string | undefined;
  site?: string | undefined;
  size?: "lg" | "md" | "sm";
}) {
  // Corners rounded a little at every size, never a circle: most services'
  // icons are square, and a square inside a circle reads as a mistake.
  const box =
    size === "lg"
      ? "size-12 rounded-xl"
      : size === "sm"
        ? "size-4 rounded-sm"
        : "size-9 rounded-lg";
  // The icon is the tile rather than a mark sitting in the middle of one. A
  // service's own icon is square and usually carries its own background, so
  // one drawn small inside a rounded plate reads as two icons: a sharp square
  // floating in a soft one. Filling the box means the parent's rounding and
  // its clip are what shape it, and the plate below only ever shows through
  // an icon that brought no background of its own.
  const label = name ?? hostOf(site);
  const initial = label ? (
    <span
      aria-label={label}
      className={cn(
        "grid size-full place-items-center font-semibold text-white",
        size === "lg" ? "text-xl" : size === "sm" ? "text-[9px]" : "text-sm",
      )}
      role="img"
      style={{ backgroundColor: colorFor(label) }}
    >
      {initialOf(label)}
    </span>
  ) : null;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-muted",
        box,
        className,
      )}
    >
      {site ? (
        <Favicon
          className="size-full rounded-none border-0 bg-transparent ring-0"
          fallback={initial}
          url={site}
        />
      ) : (
        initial
      )}
    </span>
  );
}

/** A color for a name, the same every time: one of the deep topic tints. */
function colorFor(label: string): string {
  const deep = TOPIC_COLORS.slice(TOPIC_COLORS.length / 2);
  let hash = 0;
  for (const char of label.toLowerCase()) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return deep[hash % deep.length] ?? deep[0] ?? "#3b6ef6";
}

/** The site's host without its `www.`, or nothing for no site. */
function hostOf(site: string | undefined): string | undefined {
  if (!site) {
    return undefined;
  }
  const host = URL.canParse(site) ? new URL(site).hostname : site;
  return host.replace(/^www\./, "") || undefined;
}

function initialOf(label: string): string {
  const first = label.trim().codePointAt(0);
  return first === undefined ? "" : String.fromCodePoint(first).toUpperCase();
}
