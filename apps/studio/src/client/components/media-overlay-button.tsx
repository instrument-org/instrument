import { Button } from "./ui/button";

export function MediaOverlayButton({
  className,
  icon,
  label,
  onClick,
}: {
  className?: string;
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Button
      className={className}
      onClick={onClick}
      size="xs"
      type="button"
      variant="default"
    >
      {icon}
      {label}
    </Button>
  );
}
