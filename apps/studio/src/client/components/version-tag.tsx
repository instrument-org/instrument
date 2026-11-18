import { cn } from "@/client/lib/utils";

/**
 * A version of a file by its number, `v2`, as a chat counts a file's
 * versions: in the version row, the versions list, a reply's file card and
 * the reply box's chip.
 */
export function VersionTag({
  className,
  number,
}: {
  className?: string;
  number: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md bg-foreground/8 px-1.5 text-xs font-semibold text-foreground tabular-nums",
        className,
      )}
    >
      v{number}
    </span>
  );
}

/** A version's number as a tab's 16px mark, in place of its file's icon. */
export function VersionMark({ number }: { number: number }) {
  return (
    <span className="grid size-4 shrink-0 place-items-center rounded-sm bg-foreground/9 text-[9px] leading-none font-bold tracking-tight text-foreground tabular-nums">
      v{number}
    </span>
  );
}
