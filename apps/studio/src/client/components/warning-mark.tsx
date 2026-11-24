import { WarningIcon } from "@phosphor-icons/react/Warning";

/** The amber mark a step or a turn that went wrong wears. */
export function WarningMark() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-warning-500/15">
      <WarningIcon className="size-3 text-warning-700 dark:text-warning-300" />
    </span>
  );
}
