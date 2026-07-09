import { DevModeCard, DevModeCardHeader } from "./dev-mode-card";

export function ModelContextDebugCard({
  className,
  text,
}: {
  className?: string;
  text: string;
}) {
  return (
    <DevModeCard className={className}>
      <DevModeCardHeader caption="Injected into prompt." />
      <pre className="mt-1.5 font-mono text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground">
        {text}
      </pre>
    </DevModeCard>
  );
}
