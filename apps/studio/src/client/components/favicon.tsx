import { useImageArrival } from "@/client/hooks/use-image-arrival";
import { getFaviconUrl } from "@/client/lib/favicon-url";
import { cn } from "@/client/lib/utils";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function Favicon({
  className,
  url,
}: {
  className?: string;
  url: string;
}) {
  const hostname = URL.canParse(url) ? new URL(url).hostname : url;
  const faviconUrl = getFaviconUrl(url);
  const arrival = useImageArrival(faviconUrl, "icon");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <img
          alt={`Favicon for ${hostname}`}
          className={cn(
            "size-4 shrink-0 rounded-full border border-border/50 bg-background",
            arrival.className,
            className,
          )}
          onLoad={arrival.onLoad}
          src={faviconUrl}
        />
      </TooltipTrigger>
      <TooltipContent>{hostname}</TooltipContent>
    </Tooltip>
  );
}
