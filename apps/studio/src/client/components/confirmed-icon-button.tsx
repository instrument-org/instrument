import { useTimedFlag } from "@/client/hooks/use-timed-flag";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { type ComponentProps } from "react";

import { IconButton } from "./icon-button";

/**
 * An icon button that says it did something: the check stands in for its
 * icon for a moment after a click, and the tooltip says what was done. The
 * same moment the copy button keeps, from the same timer, so a second click
 * starts it over and an unmount ends it.
 */
export function ConfirmedIconButton({
  icon,
  onClick,
  successTooltip = "Done!",
  tooltip,
  ...rest
}: ComponentProps<typeof IconButton> & {
  successTooltip?: string;
}) {
  const { active: showCheck, trigger } = useTimedFlag();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    trigger();
  };

  return (
    <IconButton
      icon={showCheck ? CheckIcon : icon}
      onClick={handleClick}
      tooltip={showCheck ? successTooltip : tooltip}
      {...rest}
    />
  );
}
