/**
 * Closing the side panel: a window with its panel ruled off at the right
 * and an arrow pushing toward it, the way Chrome draws Close side panel.
 * Drawn to Phosphor's grid (a 256 box and 16-unit round strokes) so it sits
 * with the row's other marks; Phosphor's sidebar alone is the app's own
 * sidebar toggle, which this must not read as.
 */
export function CloseSidePanelIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={16}
      viewBox="0 0 256 256"
    >
      <rect height="160" rx="16" width="192" x="32" y="48" />
      <path d="M168 48v160" />
      <path d="M72 128h56M104 104l24 24-24 24" />
    </svg>
  );
}
