/**
 * A tab group: a window whose top is a strip of three tabs, the first open
 * into the page below. Drawn to Phosphor's grid (a 256 box and 16-unit round
 * strokes) so it sits with the menus' other marks.
 */
export function TabGroupIcon({ className }: { className?: string }) {
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
      <path d="M96 48v48M160 48v48M96 96h128" />
    </svg>
  );
}
