import { cn } from "@/client/lib/utils";

import { ExternalLink } from "./external-link";
import { Favicon } from "./favicon";

export function SourceLink({
  className,
  title,
  url,
}: {
  className?: string;
  title?: string;
  url: string;
}) {
  const { hostname, pathLabel } = parseUrlParts(url);
  const trimmedTitle = title?.trim();
  const isFootnote = trimmedTitle ? isFootnoteTitle(trimmedTitle) : false;
  const isMeaningful =
    !!trimmedTitle &&
    !isFootnote &&
    trimmedTitle !== url &&
    trimmedTitle.length >= 3;

  const primary = isMeaningful
    ? trimmedTitle
    : pathLabel
      ? `${hostname}${pathLabel}`
      : hostname;
  const secondary = isMeaningful && primary !== hostname ? hostname : undefined;

  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-sm", className)}>
      {isFootnote && trimmedTitle && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground/70 tabular-nums">
          {trimmedTitle}
        </span>
      )}
      <Favicon url={url} />
      <ExternalLink
        className="flex min-w-0 items-baseline gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        href={url}
      >
        <span className="truncate">{primary}</span>
        {secondary && (
          <span className="shrink-0 text-xs text-muted-foreground/70">
            ({secondary})
          </span>
        )}
      </ExternalLink>
    </div>
  );
}

function isFootnoteTitle(trimmed: string): boolean {
  return /^[[(]?\d+[\]).]?$/.test(trimmed);
}

function parseUrlParts(url: string): {
  hostname: string;
  pathLabel: string | undefined;
} {
  if (!URL.canParse(url)) {
    return { hostname: url, pathLabel: undefined };
  }
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^www\./, "");
  const path = `${parsed.pathname}${parsed.search}`.replace(/\/+$/, "");
  const pathLabel = path && path !== "/" ? path : undefined;
  return { hostname, pathLabel };
}
