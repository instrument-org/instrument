import { Favicon, FaviconFallback } from "@/client/components/favicon";
import { cn } from "@/client/lib/utils";

/**
 * An app's icon: the site's own favicon through the proxy, set into a plate
 * of its own, so the directory, the card, the band and the rail all draw a
 * service the same way. The plate is the whole of the tile: one rounded
 * surface with a hairline, the mark inset a little inside it, so a service
 * whose mark carries its own square background and one whose mark is bare
 * read as the same kind of thing, and nothing draws a second frame around
 * it. At the small size there is no room for a plate: the mark stands
 * alone, softened at the corners, the way a site's icon does on a row or in
 * a chip. A site with no icon anywhere has the initial every surface draws
 * for it; with no site to ask, the app's own initial on the same quiet tile
 * fills the box, so a missing mark reads as missing everywhere.
 */
export function AppIcon({
  className,
  name,
  site,
  size = "md",
}: {
  className?: string;
  /** What the app is called, which its initial comes from when it has no site. */
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
    // A favicon's own corners at this size: a tighter radius than the plates,
    // so a small initial reads as a site's mark and not a pill.
    sm: "size-4 rounded-[3px]",
    xl: "size-16 rounded-2xl p-2.5 shadow-xs ring-1 ring-border",
  }[size];
  const initial = name ? (
    <span
      aria-label={name}
      className={cn(
        "grid size-full place-items-center rounded-[inherit] bg-foreground/10 font-semibold text-foreground/60",
        size === "xl"
          ? "text-2xl"
          : size === "lg"
            ? "text-xl"
            : size === "sm"
              ? "text-[9px]"
              : "text-sm",
        // Line height pinned to the letter, so its box is never taller than a
        // small plate and the letter sits centered rather than low. After the
        // size, since a font size given later would take the line height back.
        "leading-none",
      )}
      role="img"
    >
      {initialOf(name)}
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
          fallback={
            <FaviconFallback
              className={cn(
                "size-full",
                size === "sm" ? "rounded-sm" : "rounded-[22%]",
              )}
              label={site}
            />
          }
          url={site}
        />
      ) : (
        initial
      )}
    </span>
  );
}

function initialOf(label: string): string {
  const first = label.trim().codePointAt(0);
  return first === undefined ? "" : String.fromCodePoint(first).toUpperCase();
}
