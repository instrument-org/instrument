import { useTimedFlag } from "@/client/hooks/use-timed-flag";
import { immediateClickHandlers } from "@/client/lib/immediate-click";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

export function CopyButton({
  className,
  disabled,
  iconSize = 16,
  onCopy,
  onPointerDown,
  ...props
}: Omit<React.ComponentPropsWithoutRef<"button">, "onClick"> & {
  className?: string;
  disabled?: boolean;
  iconSize?: number;
  onCopy: () => Promise<void> | void;
}) {
  const { active: showCheck, trigger } = useTimedFlag();

  const handleClick = async () => {
    if (disabled) {
      return;
    }
    await onCopy();
    trigger();
  };

  return (
    <button
      {...props}
      aria-label="Copy"
      className={className}
      disabled={disabled}
      {...immediateClickHandlers<HTMLButtonElement>({
        onClick: () => void handleClick(),
        onPointerDown,
      })}
    >
      {showCheck ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
    </button>
  );
}
