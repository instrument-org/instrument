import { cn } from "@/client/lib/utils";

/**
 * The address field's own look: a solid shade of the ground it sits on,
 * named as `--field-fill` so what covers the words at its end paints the
 * same color, inside a faint ring. Worn by the field in a tab's row and by
 * the strip on a browser card in a chat, so the two read as one control.
 */
export const ADDRESS_FIELD_CLASS_NAME =
  "bg-(--field-fill) ring-1 ring-foreground/[0.06] [--field-fill:color-mix(in_oklab,var(--foreground)_4.5%,var(--background))]";

/**
 * A page's address said whole, the way a browser's field says it: the host
 * quiet, the part of it you are reading loud. An extension's own page keeps
 * its scheme (`withScheme`), which is what says whose it is.
 */
export function PageAddress({
  className,
  url,
  withScheme = false,
}: {
  className?: string;
  url: string;
  withScheme?: boolean;
}) {
  const { host, rest } = splitUrl(url, { withScheme });
  return (
    <span className={cn("min-w-0 flex-1 truncate", className)}>
      <span className="text-muted-foreground">{host}</span>
      {rest}
    </span>
  );
}

function splitUrl(url: string, { withScheme }: { withScheme: boolean }) {
  try {
    const parsed = new URL(url);
    return {
      host: withScheme ? `${parsed.protocol}//${parsed.host}` : parsed.host,
      // The bare root is left off, the way a browser leaves it off, unless a
      // query follows it and would otherwise hang off the host.
      rest:
        parsed.pathname === "/" && !parsed.search
          ? ""
          : `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return { host: url, rest: "" };
  }
}
