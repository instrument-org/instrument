import { Favicon, FaviconFallback } from "@/client/components/favicon";
import { cn } from "@/client/lib/utils";
import { isDirectoryIconUrl } from "@/shared/directory-icon";

/**
 * An app's icon: the site's own favicon through the proxy, set into a plate
 * of its own, so the directory, the card, the band and the rail all draw a
 * service the same way. The plate is the whole of the tile: one rounded
 * surface with a hairline, the mark inset a little inside it, so a service
 * whose mark carries its own square background and one whose mark is bare
 * read as the same kind of thing, and nothing draws a second frame around
 * it. At the small size there is no room for a plate: the mark stands
 * alone on whatever holds it, softened at the corners, the way a site's icon
 * does on a row, in a chip or in a button. A dark mark on a dark surface is
 * dim there, as it is in any other chrome that draws it. A site with no
 * icon anywhere has the initial every surface draws for it; with no site to
 * ask, the app's own initial on the same quiet tile
 * fills the box, so a missing mark reads as missing everywhere. A service
 * the directory ships a mark for is drawn with that mark, on the same plate,
 * in place of its site's favicon. An app whose
 * server drives an app installed here has that app's own icon, which stands
 * in for the site's: a desktop app's icon carries its own shape and is drawn
 * whole, with no plate behind it, its corners cut to the plate's.
 */
export function AppIcon({
  className,
  icon,
  name,
  site,
  size = "md",
}: {
  className?: string;
  /**
   * The app's own icon or its installed Mac app's, drawn whole in place of the
   * site's; or the directory's mark for the service, drawn on the plate.
   */
  icon?: string | undefined;
  /** What the app is called, which its initial comes from when it has no site. */
  name?: string | undefined;
  site?: string | undefined;
  size?: "lg" | "md" | "sm" | "xl";
}) {
  // Corners rounded a little at every size, never a circle: most services'
  // icons are square, and a square inside a circle reads as a mistake. The
  // inset grows with the plate, so the mark keeps the same share of it.
  const box = {
    lg: "size-12 rounded-xl bg-card p-2 shadow-xs ring-1 ring-border",
    md: "size-9 rounded-lg bg-card p-1.5 shadow-xs ring-1 ring-border",
    // A favicon's own corners at this size: a tighter radius than the plates,
    // so a small initial reads as a site's mark and not a pill. No ground of
    // its own: the button, chip or row it sits in is its surface.
    sm: "size-4 rounded-[3px]",
    xl: "size-16 rounded-2xl bg-card p-2.5 shadow-xs ring-1 ring-border",
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
  // A service's mark from the directory sits on the plate as a favicon does;
  // any other icon is an app's own and is drawn whole.
  const mark =
    icon !== undefined && isDirectoryIconUrl(icon) ? icon : undefined;
  if (icon && !mark) {
    return (
      <img
        alt={name ?? ""}
        className={cn(
          "shrink-0 object-contain",
          // Cut to the plate's corners, so an icon drawn edge to edge (store
          // artwork, which leaves the corners to the system, or a square the
          // agent drew) has the plate's outline. A Mac app's icon keeps a
          // margin of its own and loses nothing.
          {
            lg: "size-12 rounded-xl",
            md: "size-9 rounded-lg",
            sm: "size-4 rounded-[3px]",
            xl: "size-16 rounded-2xl",
          }[size],
          className,
        )}
        draggable={false}
        loading="lazy"
        src={icon}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden",
        // The initial is the plate's own art and fills it edge to edge.
        !site && !mark && "p-0",
        box,
        className,
      )}
    >
      {mark ? (
        <img
          alt={name ?? ""}
          className={cn(
            "size-full object-contain",
            size === "sm" ? "rounded-sm" : "rounded-[22%]",
          )}
          draggable={false}
          // The directory draws one per service, each a request the main
          // process answers, so the ones below the fold wait until the
          // scroll nears them rather than all arriving on open.
          loading="lazy"
          src={mark}
        />
      ) : site ? (
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
