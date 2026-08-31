import { useTimedFlag } from "@/client/hooks/use-timed-flag";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CopyIcon } from "@phosphor-icons/react/Copy";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function CopyButton({
  className,
  disabled,
  iconSize = 16,
  label = "Copy",
  onCopy,
  tooltip,
  ...props
}: Omit<React.ComponentPropsWithoutRef<"button">, "onClick"> & {
  className?: string;
  disabled?: boolean;
  iconSize?: number;
  /** The accessible name, where several copies share one screen. */
  label?: string;
  onCopy: () => Promise<void> | void;
  /**
   * What the button says it will copy, for the places where "Copy" on its own
   * leaves the reader guessing which of the things in front of them it means.
   * Absent, the button carries no tooltip at all.
   */
  tooltip?: string;
}) {
  const { active: showCheck, trigger } = useTimedFlag();

  const handleClick = async () => {
    if (disabled) {
      return;
    }
    await onCopy();
    trigger();
  };

  const button = (
    <button
      {...props}
      aria-label={label}
      className={className}
      disabled={disabled}
      onClick={() => void handleClick()}
    >
      {showCheck ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
    </button>
  );

  if (!tooltip) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      {/* Follows the icon: the check is the only report that the copy
          happened, and it is gone in a second. */}
      <TooltipContent>{showCheck ? "Copied" : tooltip}</TooltipContent>
    </Tooltip>
  );
}
