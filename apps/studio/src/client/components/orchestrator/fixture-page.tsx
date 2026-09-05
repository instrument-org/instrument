import { type ReactNode } from "react";

/** A screen that exists so the sidebar can be felt whole, with a line saying what will live in it. */
export function FixturePage({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="flex h-full flex-col px-8 pt-12">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
