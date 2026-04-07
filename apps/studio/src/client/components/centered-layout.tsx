export function CenteredLayout({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col overflow-y-auto bg-background">
      <div className="flex w-full flex-1 items-center justify-center py-8">
        {children}
      </div>
      {footer && (
        <div className="pb-6 text-center text-xs text-balance text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary">
          {footer}
        </div>
      )}
    </div>
  );
}
