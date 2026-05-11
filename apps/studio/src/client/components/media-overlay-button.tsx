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
        "bg-white text-stone-950 hover:bg-stone-50",
        "dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700",
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
