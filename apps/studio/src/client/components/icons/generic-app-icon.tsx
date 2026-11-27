/**
 * An app with no icon of its own to show: an app icon's rounded tile with a
 * highlight in its corner. Drawn to Phosphor's grid (a 256 box and 16-unit
 * round strokes).
 */
export function GenericAppIcon({ className }: { className?: string }) {
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
      <rect height="192" rx="56" width="192" x="32" y="32" />
      <path d="M80 112V96a16 16 0 0 1 16-16h16" />
    </svg>
  );
}
