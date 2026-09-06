import { Favicon } from "@/client/components/favicon";
import { cn } from "@/client/lib/utils";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";

/**
 * An app's icon: the site's own favicon through the proxy, on a tile, so the
 * directory and the card and the sidebar all draw a service the same way.
 * With no site to ask, the generic window.
 */
export function AppIcon({
  className,
  site,
  size = "md",
}: {
  className?: string;
  site?: string | undefined;
  size?: "lg" | "md" | "sm";
}) {
  const box =
    size === "lg"
      ? "size-12 rounded-xl"
      : size === "sm"
        ? "size-4 rounded-sm"
        : "size-9 rounded-lg";
  const glyph =
    size === "lg" ? "size-7" : size === "sm" ? "size-3.5" : "size-5";
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
          className={cn("rounded-none border-0 ring-0", glyph)}
          url={site}
        />
      ) : (
        <AppWindowIcon className={cn("text-muted-foreground", glyph)} />
      )}
    </span>
  );
}
