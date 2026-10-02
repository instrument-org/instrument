/**
 * Another of the thing, in a tab of its own: a square with a plus in it at the
 * lower right, and a square the same size behind it at the upper left, broken
 * where the front one stands over it. Drawn to Phosphor's grid (a 256 box and
 * 16-unit round strokes) so it sits with the menus' other marks; Phosphor's
 * plus in a square says "add", and the square behind is what says "a second
 * one", the way Safari draws New Tab.
 */
export function NewTabIcon({ className }: { className?: string }) {
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
      {/* The square behind, stopping short of the one in front. */}
      <path d="M168 68V56a24 24 0 0 0-24-24H56a24 24 0 0 0-24 24v88a24 24 0 0 0 24 24h12" />
      <rect height="136" rx="24" width="136" x="88" y="88" />
      <path d="M156 124v64M124 156h64" />
    </svg>
  );
}
