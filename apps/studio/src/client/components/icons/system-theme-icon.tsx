/**
 * The theme that follows the system: Phosphor's Monitor with the screen split
 * corner to corner, light above and dark below. Drawn to Phosphor's grid (a
 * 256 box and 16-unit round strokes).
 */
export function SystemThemeIcon({ className }: { className?: string }) {
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
      <rect height="144" rx="16" width="192" x="32" y="48" />
      <path d="M96 224h64" />
      <path d="M216 56V184H40Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
