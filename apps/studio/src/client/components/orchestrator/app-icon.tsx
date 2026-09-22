import { Favicon } from "@/client/components/favicon";
import { cn } from "@/client/lib/utils";

import { TOPIC_COLORS } from "./topic-colors";

/**
 * An app's icon: the site's own favicon through the proxy, set into a plate
 * of its own, so the directory, the card, the band and the rail all draw a
 * service the same way. The plate is the whole of the tile: one rounded
 * surface with a hairline, the mark inset a little inside it, so a service
 * whose mark carries its own square background and one whose mark is bare
 * read as the same kind of thing, and nothing draws a second frame around
 * it. At the small size there is no room for a plate: the mark stands
 * alone, softened at the corners, the way a site's icon does on a row or in
 * a chip. With no site to ask, or a site with no icon anywhere, the app's
 * initial on a color of its own fills the box instead, so a service without
 * a mark still has a face a person can tell from the next one.
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
  size?: "lg" | "md" | "sm" | "xl";
}) {
  // Corners rounded a little at every size, never a circle: most services'
  // icons are square, and a square inside a circle reads as a mistake. The
  // inset grows with the plate, so the mark keeps the same share of it.
  const box = {
    lg: "size-12 rounded-xl p-2 shadow-xs ring-1 ring-border",
    md: "size-9 rounded-lg p-1.5 shadow-xs ring-1 ring-border",
    sm: "size-4 rounded-sm",
    xl: "size-16 rounded-2xl p-2.5 shadow-xs ring-1 ring-border",
  }[size];
  const label = name ?? hostOf(site);
  const initial = label ? (
    <span
      aria-label={label}
      className={cn(
        "grid size-full place-items-center rounded-[inherit] font-semibold text-white",
        size === "xl"
          ? "text-2xl"
          : size === "lg"
            ? "text-xl"
            : size === "sm"
              ? "text-[9px]"
              : "text-sm",
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
        "grid shrink-0 place-items-center overflow-hidden bg-card",
        // The initial is the plate's own art and fills it edge to edge.
        !site && "p-0",
        box,
        className,
      )}
    >
      {site ? (
        <Favicon
          // A mark that brought a square background of its own is softened
          // at the corners, so it sits in the plate rather than on it.
          className={cn(
            "size-full border-0 bg-transparent ring-0 dark:bg-transparent",
            size === "sm" ? "rounded-sm" : "rounded-[22%]",
          )}
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
