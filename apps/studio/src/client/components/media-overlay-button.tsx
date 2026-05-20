import { cn } from "@/client/lib/utils";

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
    <button
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-1",
        "text-xs font-medium shadow-sm",
        "bg-card text-foreground hover:bg-muted",
        "dark:bg-card dark:hover:bg-muted",
        className,
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}
