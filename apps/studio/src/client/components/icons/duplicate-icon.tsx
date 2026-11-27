/**
 * A second one of the thing, made in place: Phosphor's Copy with a plus in
 * the front sheet, the way macOS draws Duplicate. Drawn to Phosphor's grid (a
 * 256 box and 16-unit round strokes).
 */
export function DuplicateIcon({ className }: { className?: string }) {
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
      <path d="M88 88V48a8 8 0 0 1 8-8h112a8 8 0 0 1 8 8v112a8 8 0 0 1-8 8h-40" />
      <rect height="128" rx="8" width="128" x="40" y="88" />
      <path d="M104 124v56M76 152h56" />
    </svg>
  );
}
