import { EyeIcon } from "@phosphor-icons/react";

import { Badge } from "../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function DeveloperModeBadge() {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Badge
          className="border border-dev-700 px-1 py-0 text-[10px] text-dev-700 uppercase dark:border-transparent dark:bg-dev-500 dark:text-dev-300"
          variant="outline"
        >
          <EyeIcon className="size-2.5" />
          Dev mode
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        This element is only visible in developer mode
      </TooltipContent>
    </Tooltip>
  );
}
