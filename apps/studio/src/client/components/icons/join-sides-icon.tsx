/**
 * Two sides becoming one: the frame Phosphor's split square draws, with an
 * arrow from each side meeting in the middle. Drawn to Phosphor's grid (a 256
 * box and 16-unit round strokes).
 */
export function JoinSidesIcon({ className }: { className?: string }) {
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
      <path d="M64 128h44M84 104l24 24-24 24M192 128h-44M172 104l-24 24 24 24" />
    </svg>
  );
}
