import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { cn } from "@/client/lib/utils";
import { ArrowBendDownRightIcon } from "@phosphor-icons/react/ArrowBendDownRight";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { type ReactNode } from "react";

/**
 * The one thing an app's page asks for before it is connected: what it is,
 * what it gets the person, and the button at the card's end. What takes room
 * of its own, as a key's field, goes under them.
 */
export function AskCard({
  children,
  end,
  line,
  title,
}: {
  children?: ReactNode;
  end?: ReactNode;
  line?: ReactNode;
  title: string;
}) {
  return (
    <div className="mt-8 rounded-2xl border border-border bg-card px-6 py-5">
      <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
        <div className="min-w-56 flex-1">
          <p className="text-[17px] leading-6 font-medium">{title}</p>
          {line ? (
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              {line}
            </div>
          ) : null}
        </div>
        {end}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/** An app's accounts, a row each. */
export function AccountsCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
      {children}
    </div>
  );
}

export function AccountRow({
  end,
  isWarning = false,
  line,
  onOpen,
  title,
}: {
  end?: ReactNode;
  isWarning?: boolean;
  line: ReactNode;
  /** Opens the account's own page, for an account this page is not. */
  onOpen?: () => void;
  title: string;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 px-5 py-2.5">
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button
            className="block max-w-full truncate text-left text-sm font-medium hover:underline"
            onClick={onOpen}
            type="button"
          >
            {title}
          </button>
        ) : (
          <p className="truncate text-sm font-medium">{title}</p>
        )}
        <div
          className={cn(
            "text-[13px] leading-5",
            isWarning
              ? "text-warning-700 dark:text-warning-300"
              : "text-muted-foreground",
          )}
        >
          {line}
        </div>
      </div>
      {end ? (
        <div className="flex shrink-0 items-center gap-1.5">{end}</div>
      ) : null}
    </div>
  );
}

export function AddAccountRow({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      className="flex h-12 w-full items-center gap-2 rounded-b-2xl px-5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-50"
      disabled={disabled}
      onClick={onAdd}
      type="button"
    >
      <PlusIcon className="size-4" />
      Add another account
    </button>
  );
}

/** The dots at the end of an account's row. */
export function RowMenu({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={label} size="icon-sm" variant="ghost">
          <DotsThreeIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Requests a person might make of the app, pressable once it is connected. */
export function ThingsToDo({
  isConnected,
  lines,
  onAsk,
}: {
  isConnected: boolean;
  lines: readonly string[];
  onAsk: (line: string) => void;
}) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <section className={cn("mt-8", !isConnected && "opacity-50")}>
      <h2 className="mb-2.5 text-[13px] font-medium text-muted-foreground">
        Things to do
      </h2>
      <div className="flex flex-col items-start gap-2">
        {lines.map((line) => (
          <button
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-left text-[13px] leading-5 shadow-xs not-disabled:hover:bg-accent"
            disabled={!isConnected}
            key={line}
            onClick={() => {
              onAsk(line);
            }}
            type="button"
          >
            <ArrowBendDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            {line}
          </button>
        ))}
      </div>
    </section>
  );
}
