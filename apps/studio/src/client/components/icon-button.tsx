import { type Icon } from "@phosphor-icons/react";
import { type ComponentProps } from "react";

import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function IconButton({
  className = "h-6 w-6 p-0",
  icon: Icon,
  size = "sm",
  tooltip,
  variant = "ghost",
  ...buttonProps
}: ComponentProps<typeof Button> & {
  icon: Icon;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className={className}
          size={size}
          variant={variant}
          {...buttonProps}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
