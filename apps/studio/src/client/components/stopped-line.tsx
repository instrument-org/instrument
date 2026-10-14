import { StopCircleIcon } from "@phosphor-icons/react/StopCircle";

/** A quiet line saying a task or a turn was stopped before it finished, and by what. */
export function StoppedLine({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <StopCircleIcon className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}
