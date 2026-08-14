import { CheckIcon } from "@phosphor-icons/react/Check";
import { type ComponentProps, useState } from "react";

import { IconButton } from "./icon-button";

export function ConfirmedIconButton({
  icon,
  onClick,
  successTooltip = "Done!",
  tooltip,
  ...rest
}: ComponentProps<typeof IconButton> & {
  successTooltip?: string;
}) {
  const [success, setSuccess] = useState(false);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
    }, 1000);
  };

  return (
    <IconButton
      icon={success ? CheckIcon : icon}
      onClick={handleClick}
      tooltip={success ? successTooltip : tooltip}
      {...rest}
    />
  );
}
